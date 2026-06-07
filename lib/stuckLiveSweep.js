// lib/stuckLiveSweep.js — break the stuck-LIVE feedback loop.
//
// THE PROBLEM (from the launch-blocker root-cause): the only path to
// status='final' is API-Sports returning FT/AET/PEN. When the daily
// API-Sports cap exhausts, those calls fail. Matches stay status='live'
// past their real end time. getMatchesToPoll keeps including them. Every
// minute, poll-live tries to call the API for each, fails (cap exhausted),
// stays stuck. ~3 API attempts/match/min × N stuck matches → infinite
// wasted bandwidth.
//
// THE FIX (this file): a per-tick sweep that runs before the normal poll
// loop. For matches in status='live' AND kickoff_at older than the
// STUCK_LIVE_TIMEOUT, the sweep resolves them out of the live state so
// they drop from the poll queue.
//
// CRITICAL: do NOT false-flip a long-but-still-playing match. A WC
// knockout going to extra time runs ~120 min play + ~20 min stoppage/
// breaks = ~140+ min wall-clock. The threshold is 180 min — a SAFETY
// NET for genuinely-dead matches, not a normal-path mechanism. The
// sweep also CALLS THE API ONCE per match it considers before flipping
// (the "poll-once-before-flip" guarantee) so a still-live match per
// the API stays live; only matches the API confirms FT, OR matches we
// CAN'T REACH, get flipped.
//
// When the circuit breaker is tripped (the cap-exhaustion sentinel),
// the sweep still runs but skips the poll-once attempt (it would just
// fail) and uses the last-known DB score as a fallback. Flipped rows
// in this mode get matches.timer_forced_final_at = now() — the audit
// trail for forced finals that we may want to re-resolve once the
// cap's back.

import { sql } from './db.js';
import { apiSports, DailyCapError } from './apiSports.js';
import { tripDailyCap } from './cronCircuitBreaker.js';

// ============================================================================
// THRESHOLD — load-bearing constant.
//
// 180 minutes is the safety-net ceiling. Real match wall-clock breakdown:
//   regulation (45 + ~5 stoppage + 15 break + 45 + ~5 stoppage)  ≈ 115 min
//   knockout extra time (15 + 15 break + 15)                     +  45 min
//   penalty shootout                                              +  ~15 min
//                                                                ────────
//   absolute upper bound for a regulation→ET→PEN match:            175 min
// 180 min leaves a 5-min cushion before we'd ever consider flipping a still-
// playing match.
//
// Do NOT lower below 175 without re-validating against the WC bracket format.
// Lower thresholds (130, 150) are too tight and risk false-flipping ET matches.
// ============================================================================
export const STUCK_LIVE_TIMEOUT_MIN = 180;

// Sweep outcome shapes:
//   'api_confirmed_final'  — API said FT/AET/PEN; we flipped to real values
//   'api_says_still_live'  — API said the match is genuinely still in play
//                             (e.g. 1H/2H/ET/HT); we LEAVE IT ALONE
//   'timer_forced_final'   — API call failed (or breaker tripped); we
//                             fallback-flipped using last-known DB score
//                             and stamped timer_forced_final_at = now()

const FINAL_STATUSES = new Set(['FT', 'AET', 'PEN']);

// Map API-Sports's short status into our DB status, kept LOCAL here so we
// don't import from syncFixture (would create a cycle). Same logic.
function mapApiStatusShort(short) {
  if (FINAL_STATUSES.has(short)) return 'final';
  if (['1H', 'HT', '2H', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE'].includes(short)) return 'live';
  if (['CANC', 'ABD', 'AWD', 'WO'].includes(short)) return 'cancelled';
  if (short === 'PST') return 'postponed';
  if (['TBD', 'NS'].includes(short)) return 'scheduled';
  return null; // unknown — let caller decide
}

// Force-flip a match to status='final', stamping the audit marker. Uses
// whatever home/away_score is currently on the row (the last value we
// successfully wrote, before the API went dark). This is the fallback
// path used when API call fails OR breaker is tripped.
async function forceFinalFromLastKnown(matchId) {
  await sql`
    UPDATE matches
       SET status = 'final',
           timer_forced_final_at = now(),
           updated_at = now()
     WHERE id = ${matchId}
       AND status = 'live'
  `;
}

// Real-final flip, from an API-Sports fixture object. Updates score from
// the API's actual numbers (in case the last poll missed the final goal).
// timer_forced_final_at stays NULL — this is an API-confirmed final.
async function apiConfirmedFinal(matchId, apiFixture) {
  const home = apiFixture.goals?.home ?? null;
  const away = apiFixture.goals?.away ?? null;
  await sql`
    UPDATE matches
       SET status = 'final',
           home_score = COALESCE(${home}, home_score),
           away_score = COALESCE(${away}, away_score),
           timer_forced_final_at = NULL,
           updated_at = now()
     WHERE id = ${matchId}
       AND status = 'live'
  `;
}

// Sweep entry point. Caller passes `breakerTripped` (the current state of
// the circuit breaker) so the sweep skips API calls when the breaker is
// already known engaged.
//
// Returns: { swept, resolved: [{ slug, outcome, ... }], wouldNotFlip: [{slug, reason}] }
export async function sweepStuckLive({ breakerTripped = false } = {}) {
  const candidates = await sql`
    SELECT id, slug, external_ids,
           home_score, away_score, kickoff_at
      FROM matches
     WHERE status = 'live'
       AND kickoff_at < now() - (${STUCK_LIVE_TIMEOUT_MIN} || ' minutes')::interval
     ORDER BY kickoff_at ASC
  `;

  const results = { swept: candidates.length, resolved: [], wouldNotFlip: [] };

  for (const m of candidates) {
    const apiId = Number(m.external_ids?.api_sports);
    if (!apiId) {
      // No API ID → can't even attempt confirmation. Fallback to timer-forced final.
      await forceFinalFromLastKnown(m.id);
      results.resolved.push({ slug: m.slug, outcome: 'timer_forced_final', reason: 'no_api_id' });
      continue;
    }

    // BREAKER-TRIPPED BRANCH: skip the poll-once attempt entirely; it would
    // just fail. Go straight to fallback. This keeps matches from being
    // stranded as permanently-live while the breaker is engaged.
    if (breakerTripped) {
      await forceFinalFromLastKnown(m.id);
      results.resolved.push({ slug: m.slug, outcome: 'timer_forced_final', reason: 'breaker_tripped' });
      continue;
    }

    // NORMAL BRANCH: poll-once-before-flip. One API-Sports call. We don't
    // re-call events or statistics — those are cheap to lose vs. the
    // status-confirmation signal.
    let fixture = null;
    let pollError = null;
    try {
      const arr = await apiSports.fixture(apiId);
      fixture = arr?.[0] ?? null;
    } catch (err) {
      pollError = err;
      // If the poll itself revealed the daily-cap is hit (DailyCapError),
      // trip the breaker NOW so the rest of this sweep (and the rest of the
      // poll-live tick) operate in fallback mode. We continue this match in
      // fallback below; subsequent candidates in the sweep loop will see the
      // breaker tripped on their own re-checks (we'd need to pass state
      // back up — keep it simple here: just set the local flag).
      if (err instanceof DailyCapError) {
        await tripDailyCap({ reason: 'detected_in_stuckLiveSweep' });
        breakerTripped = true; // for downstream candidates in this loop
      }
    }

    if (pollError || !fixture) {
      // Poll failed (network, daily cap, anything). Fallback.
      await forceFinalFromLastKnown(m.id);
      results.resolved.push({
        slug: m.slug,
        outcome: 'timer_forced_final',
        reason: pollError instanceof DailyCapError ? 'daily_cap' : 'poll_error',
        error: pollError ? String(pollError.message ?? pollError) : 'no_fixture',
      });
      continue;
    }

    const apiShort = fixture.fixture?.status?.short;
    const mappedStatus = mapApiStatusShort(apiShort);

    if (mappedStatus === 'final') {
      await apiConfirmedFinal(m.id, fixture);
      results.resolved.push({ slug: m.slug, outcome: 'api_confirmed_final', api_status: apiShort });
    } else if (mappedStatus === 'live') {
      // CRITICAL: API confirms still-live → DO NOT flip. Match stays in
      // the poll queue. This is the path that protects an ET-going knockout
      // at minute 178 from a false flip — if the API says it's still playing
      // we trust the API, no matter the wall-clock.
      results.wouldNotFlip.push({ slug: m.slug, reason: 'api_says_still_live', api_status: apiShort });
    } else {
      // API returned something unexpected (e.g., postponed retroactively, or
      // an unknown short code). Don't force-flip — leave for the next
      // sweep + log it. We'd rather a slightly-stuck row than a wrong final.
      results.wouldNotFlip.push({ slug: m.slug, reason: 'api_unknown_status', api_status: apiShort });
    }
  }

  return results;
}
