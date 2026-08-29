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

// ============================================================================
// AND THEN GRIDIRON ARRIVED, AND 180 WAS A LIE FOR IT.
//
// Everything above reasons about a football match: 45+45 plus stoppage, extra
// time, penalties, 175 minutes absolute. That arithmetic does not survive a
// change of sport, and the candidate query never asked which sport it was
// looking at. On 29 Aug it force-finaled UNC @ TCU with 38 seconds left on the
// Q4 clock, three hours and twenty-six minutes after kickoff - an ORDINARY
// college football game, not a stuck one.
//
// THE NUMBER IS CENSUSED, NOT GUESSED - and the obvious census is a trap.
// MAX(final_seen_at - kickoff_at) over our own gridiron finals returns 1366
// minutes, which would imply a 23-hour timeout and disable the sweep entirely.
// That figure is DETECTION LAG, not duration: final_seen_at is when our poller
// noticed, so a poller that was down overnight writes a 22-hour "game".
// The honest subset is the games we polled actively, minute by minute, through
// their own endings - last night's nine NFL preseason games:
//     182, 187, 190, 194, 194, 194, 194, 201, 203 minutes
// plus UNC @ TCU, which ran 16:00Z to a provider `completed` by ~19:37Z: about
// 215 minutes. So the observed ceiling for a real gridiron game we watched end
// is ~215 minutes. 330 sits 115 minutes above that - enough for a
// multi-overtime game plus a weather delay, and still less than half the
// nonsense the naive census suggests.
// ============================================================================
export const GRIDIRON_STUCK_TIMEOUT_MIN = 330;

/** Which timeout a league gets. Gridiron is the exception; everything else
 *  keeps the soccer number this file was written for. */
export const GRIDIRON_SLUGS = Object.freeze(['nfl', 'cfb']);
export function timeoutMinFor(leagueSlug) {
  return GRIDIRON_SLUGS.includes(leagueSlug)
    ? GRIDIRON_STUCK_TIMEOUT_MIN
    : STUCK_LIVE_TIMEOUT_MIN;
}

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
           -- EVERY WRITER THAT FINALS A ROW CLEARS ITS CLOCK. This one used to
           -- leave live_state behind, because it writes status directly and
           -- never passes through upsertGame (which nulls it on a non-live
           -- status). That left UNC @ TCU sitting final with a running
           -- "Q4 00:38" on 29 Aug. Consumers all guard on status='live' so it
           -- rendered nothing - which is exactly how a stale clock survives
           -- long enough to surface somewhere that does not guard.
           metadata = COALESCE(metadata, '{}'::jsonb) || '{"live_state": null}'::jsonb,
           updated_at = now()
     WHERE id = ${matchId}
       AND status = 'live'
  `;
}

// Real-final flip, from an API-Sports fixture object. Updates score from
// the API's actual numbers (in case the last poll missed the final goal).
// timer_forced_final_at stays NULL — this is an API-confirmed final.
/**
 * THE POLL-ONCE-BEFORE-FLIP GUARANTEE, EXTENDED TO GRIDIRON.
 *
 * The guarantee above was real but unreachable for football: it keys on
 * external_ids.api_sports, and no gridiron row has that key - CFB carries
 * cfbd_game_id, NFL carries bdl_game_id or apisports_game_id. So every
 * gridiron candidate fell straight through to the timer, with no provider
 * asked. That is how 39 NFL preseason rows and one live CFB game got forced.
 *
 * ONE CALL PER LEAGUE PER SWEEP, not per game: both providers answer for a
 * whole slate at once, so the cost is flat however many candidates there are.
 * Injected and lazily cached, so a sweep with no gridiron candidate makes no
 * call and the tests need no network.
 *
 * Returns 'live' | 'final' | null. NULL MEANS UNREACHABLE, and unreachable is
 * what preserves the original safety net: a provider-silent row still gets
 * force-finaled, because the whole point of this file is that a row cannot be
 * left live forever.
 */
export function gridironStatusResolver({ fetchCfb, fetchNfl } = {}) {
  const cache = new Map();
  return async (leagueSlug, externalIds) => {
    if (!GRIDIRON_SLUGS.includes(leagueSlug)) return null;
    try {
      if (!cache.has(leagueSlug)) {
        cache.set(leagueSlug, leagueSlug === 'cfb'
          ? await (fetchCfb ?? defaultCfb)()
          : await (fetchNfl ?? defaultNfl)());
      }
      const rows = cache.get(leagueSlug) ?? [];
      const id = leagueSlug === 'cfb'
        ? externalIds?.cfbd_game_id
        : (externalIds?.apisports_game_id ?? externalIds?.bdl_game_id);
      if (id == null) return null;
      const row = rows.find((r) => String(r.id) === String(id));
      if (!row) return null;
      return leagueSlug === 'cfb'
        ? (row.status === 'in_progress' ? 'live' : row.status === 'scheduled' ? null : 'final')
        : (String(row?.status?.short ?? '').toUpperCase() === 'FT' ? 'final' : 'live');
    } catch {
      // A provider that errors is a provider that is silent. Fall back to the
      // timer rather than stranding the row live forever.
      cache.set(leagueSlug, []);
      return null;
    }
  };
}

async function defaultCfb() {
  const { cfbdScoreboardFetcher } = await import('./gridiron/cfbScoreboard.js');
  return cfbdScoreboardFetcher()();
}
async function defaultNfl() {
  const { apiSportsFootball } = await import('./apiSportsFootball.js');
  const date = new Date().toISOString().slice(0, 10);
  const r = await apiSportsFootball.games({ date });
  return (r ?? []).map((g) => ({ id: g?.game?.id ?? g?.id, status: g?.game?.status ?? g?.status }));
}

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
export async function sweepStuckLive({ breakerTripped = false, gridironStatus = null } = {}) {
  // THE TIMEOUT IS PER SPORT, APPLIED IN THE QUERY. Doing it here rather than
  // filtering afterwards means a gridiron game inside its own window is never
  // enumerated as a candidate at all - it cannot be force-finaled by a later
  // branch that forgets to check.
  const candidates = await sql`
    SELECT m.id, m.slug, m.external_ids,
           m.home_score, m.away_score, m.kickoff_at,
           l.slug AS league_slug
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
     WHERE m.status = 'live'
       AND m.kickoff_at < now() - ((CASE WHEN l.slug = ANY(${GRIDIRON_SLUGS})
                                         THEN ${GRIDIRON_STUCK_TIMEOUT_MIN}
                                         ELSE ${STUCK_LIVE_TIMEOUT_MIN} END) || ' minutes')::interval
     ORDER BY m.kickoff_at ASC
  `;

  const results = { swept: candidates.length, resolved: [], wouldNotFlip: [] };
  const askGridiron = gridironStatus ?? gridironStatusResolver();

  for (const m of candidates) {
    const timeoutMin = timeoutMinFor(m.league_slug);

    // GRIDIRON GETS THE SAME COURTESY SOCCER ALWAYS HAD: ask the provider
    // before forcing. This branch is what 39 NFL rows and one live CFB game
    // never got.
    if (GRIDIRON_SLUGS.includes(m.league_slug)) {
      const verdict = await askGridiron(m.league_slug, m.external_ids);
      if (verdict === 'live') {
        console.log(`[stuck-live] ${m.league_slug} ${m.slug}: provider says still playing at `
          + `${timeoutMin}min timeout - NOT forcing`);
        results.wouldNotFlip.push({
          slug: m.slug, reason: 'provider_says_still_live',
          league: m.league_slug, timeoutMin,
        });
        continue;
      }
      await forceFinalFromLastKnown(m.id);
      console.log(`[stuck-live] ${m.league_slug} ${m.slug}: forced final `
        + `(provider ${verdict === 'final' ? 'confirmed final' : 'silent'}, timeout ${timeoutMin}min)`);
      results.resolved.push({
        slug: m.slug,
        outcome: verdict === 'final' ? 'provider_confirmed_final' : 'timer_forced_final',
        reason: verdict === 'final' ? 'gridiron_provider_final' : 'gridiron_provider_silent',
        league: m.league_slug, timeoutMin,
      });
      continue;
    }

    const apiId = Number(m.external_ids?.api_sports);
    if (!apiId) {
      // No API ID → can't even attempt confirmation. Fallback to timer-forced final.
      await forceFinalFromLastKnown(m.id);
      console.log(`[stuck-live] ${m.league_slug} ${m.slug}: forced final (no api id, timeout ${timeoutMin}min)`);
      results.resolved.push({
        slug: m.slug, outcome: 'timer_forced_final', reason: 'no_api_id',
        league: m.league_slug, timeoutMin,
      });
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
