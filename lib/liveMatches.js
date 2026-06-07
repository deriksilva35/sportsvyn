// lib/liveMatches.js — selects matches the cron should poll right now.
//
// Predicate (three clauses):
//   1. status = 'live'                                            — every live match, every tick
//   2. status = 'scheduled' AND kickoff_at ∈ [now()-4h, now()+15m] — armed before kickoff,
//                                                                   safety net if API never
//                                                                   advances scheduled status.
//                                                                   THROTTLED for the overdue
//                                                                   half (see clause 2 detail).
//   3. status = 'postponed' AND kickoff_at >= now() - interval '8 hours'
//                                                                 — re-entry path for
//                                                                   weather/lightning delays
//
// CLAUSE 2 — THROTTLE DETAIL (poll-cost reduction, not a kickoff-catch concession):
//   The 4h15m scheduled window is split into two sub-buckets:
//
//     A. Kickoff-catch (kickoff_at in [now-15m, now+15m])
//        Always included, every tick. This is the load-bearing 30-minute
//        window centered on kickoff_at where the API transition from
//        scheduled→live must be caught promptly. NEVER throttle here.
//
//     B. Overdue (kickoff_at in [now-4h, now-15m), i.e. kickoff was 15min
//        to 4 hours ago but status hasn't flipped)
//        Throttled to roughly every 5 minutes via NOT EXISTS on a recent
//        sync_log poll. If we polled this fixture in the last 5 minutes,
//        skip it this tick. Rationale: a match still 'scheduled' 15+ min
//        after kickoff is in an API-lag edge case (rare), or a genuine
//        no-show — polling every minute won't make the API flip faster.
//
//   The kickoff window stays as-is (kickoff_at >= now() - 15 min keeps
//   the WHOLE imminent set every-tick).
//
// Clause 3 exists because API-Sports stamps PST on a same-day delay
// (e.g. lightning hold) and on a multi-day reschedule with the same
// status_short. Without a re-poll path, our cron would write
// status='postponed' on the first delayed tick and then stop polling
// forever — even though API-Sports flips PST→1H→FT once the match
// actually resumes. Haiti–NZ 2026-06-03 and Morocco–Madagascar
// 2026-06-02 both got stranded this way; both were FT 4-0 on the
// API-Sports endpoint while our DB still showed postponed.
//
// 8h covers a realistic worst case: a 90+stoppage match preceded by a
// 4-5h weather hold. Beyond 8h past the *original* kickoff_at, we
// treat the match as a genuine reschedule (the row ages out of this
// clause and stops being polled). A true multi-day reschedule will
// land as a different API-Sports fixture id and re-import as a new
// scheduled row anyway, so the original row staying postponed past 8h
// is the correct terminal state for it.
//
// FT exit: once a re-entered postponed match transitions to live
// (status='live' via clauses 1 above) and eventually final, the row
// drops out of all three clauses and is never re-polled. Monotonic.
//
// Downstream safety on a postponed-with-no-events tick:
//   - syncMatchEvents skipped (events.length > 0 guard)
//   - syncMatchStatistics skipped (length >= 2 guard)
//   - captureLiveWatchScoreTick skipped (status !== 'live'/'final' guard)
//   - matches row update is a no-op data-wise (status stays 'postponed')
//   API-Sports call cost only; no phantom DB writes.
//
// Returns rows with the API-Sports fixture id pulled out of external_ids
// so the cron can hand them straight to syncFixture(). Rows without a
// usable api_sports id are filtered out (we can't sync those).

import { sql } from './db.js';

export async function getMatchesToPoll() {
  const rows = await sql`
    SELECT
      m.id,
      m.slug,
      m.kickoff_at,
      m.status,
      m.external_ids->>'api_sports' AS api_sports_id
    FROM matches m
    WHERE
      m.status = 'live'
      OR (
        m.status = 'scheduled'
        AND m.kickoff_at <= now() + interval '15 minutes'
        AND m.kickoff_at >= now() - interval '4 hours'
        AND (
          -- Sub-bucket A — kickoff-catch (every tick, no throttle).
          -- Imminent + just-kicked-off matches must always be polled so
          -- the scheduled→live transition is caught fast.
          m.kickoff_at >= now() - interval '15 minutes'
          OR
          -- Sub-bucket B — overdue (kickoff 15min–4h ago, status still
          -- 'scheduled'). Throttle to ~5-minute cadence: skip this tick
          -- if we polled this fixture within the last 5 minutes.
          NOT EXISTS (
            SELECT 1 FROM sync_log s
             WHERE s.fixture_id = (m.external_ids->>'api_sports')::int
               AND s.polled_at > now() - interval '5 minutes'
          )
        )
      )
      OR (
        m.status = 'postponed'
        AND m.kickoff_at >= now() - interval '8 hours'
      )
    ORDER BY m.kickoff_at
  `;
  return rows.filter((r) => r.api_sports_id);
}
