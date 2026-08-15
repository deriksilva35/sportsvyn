/**
 * lib/pollers/liveWindow.js — is a league's football game live right now?
 *
 * Derived from our own matches table (scheduled kickoffs), not provider status
 * (which is a stale snapshot between syncs and, for NFL, an unverified live
 * token). A game places NOW inside its live window when its kickoff is from
 * LIVE_WINDOW_PRE_MIN ahead to LIVE_WINDOW_POST_HOURS behind — i.e.
 * kickoff_at BETWEEN (now - POST) AND (now + PRE). Excludes final/postponed/
 * cancelled. UTC throughout (kickoff_at is stored UTC via the toUtc boundary).
 *
 * ORIENTATION NOTE: a game is live for POST hours AFTER kickoff (a game runs
 * ~3.5h+), with a PRE warmup BEFORE it. So the 5h pad TRAILS kickoff and the
 * 45min pad LEADS it. (The recon/spec phrasing "kickoff BETWEEN now-45min AND
 * now+5h" inverts these; taken literally it stops 5-min polling ~45min after
 * kickoff — mid-game — so the pads are oriented here to keep live cadence through
 * the whole game. Flagged in the build report for confirmation.)
 *
 * ============================================================================
 * TBD PLACEHOLDERS ARE NOT KICKOFFS
 * ============================================================================
 * CFBD publishes a college game whose broadcast slot is not yet assigned with a
 * MIDNIGHT ET kickoff. It is a null wearing a timestamp, and a window derived
 * from it is derived from nothing.
 *
 * The 2026 CFB schedule, midnight-ET kickoffs per Saturday:
 *
 *     2026-09-05     0 of 68
 *     2026-09-12     4 of 80
 *     2026-09-26    42 of 65     65%
 *     2026-10-03    42 of 54     78%
 *     2026-10-10    38 of 46     83%
 *     2026-10-17    44 of 52     85%
 *     2026-10-24    39 of 44     89%
 *
 * From late September most of the slate carries one. With PRE 45min / POST 5h a
 * single midnight placeholder holds the window open from 23:15 the night before
 * until 05:00, and forty of them plus real evening games hold it open ~22 hours
 * a day, every Saturday, all autumn. The cost is not the requests — CFB draws on
 * CFBD, which has ~28K calls of headroom. The cost is that "is a game on" stops
 * meaning anything: final detection loses its edge, and any future CFB detail
 * fetch priced off the window would be priced off a 22-hour day.
 *
 * So a placeholder is excluded from the window and left to the 30-minute
 * baseline, which is the right cadence for a game nobody has scheduled yet. The
 * moment CFBD assigns a real slot the game stops matching the rule and enters
 * the window normally.
 *
 * STATUS OUTRANKS THE HEURISTIC. Only a `scheduled` game can be a placeholder.
 * If the feed says a game is LIVE we believe it whatever its stored kickoff
 * says — a heuristic about missing data must never be able to hide a game that
 * is actually being played.
 */

import { LIVE_WINDOW_PRE_MIN, LIVE_WINDOW_POST_HOURS } from './cadence.js';

// The ET wall-clock time of a stored UTC instant. Intl carries the IANA rules,
// so this is DST-correct without a second timezone implementation. NOT the
// provider-datetime boundary — kickoff_at is already UTC by the time it is
// stored, and nothing here parses a provider string (see ingest.js toUtc).
const ET_HHMM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
});
export function etHourMinute(instant) {
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return ET_HHMM.format(d); // "00:00" .. "23:59"
}

/**
 * Is this row a slot-not-yet-assigned placeholder rather than a real kickoff?
 *
 * Pure, so the rule is testable without a database or a Saturday in October.
 * @param {{kickoffAt: string|Date, status: string}} game
 */
export function isTbdPlaceholder(game) {
  if (game?.status !== 'scheduled') return false;   // status outranks the heuristic
  return etHourMinute(game?.kickoffAt) === '00:00';
}

/**
 * Split candidate rows into the ones that establish a window and the ones that
 * only look like they do. Returns { live, considered, tbdExcluded }.
 */
export function classifyWindowRows(rows) {
  const games = (rows ?? []).map((r) => ({ kickoffAt: r.kickoff_at ?? r.kickoffAt, status: r.status }));
  const placeholders = games.filter(isTbdPlaceholder);
  return {
    live: games.length - placeholders.length > 0,
    considered: games.length,
    tbdExcluded: placeholders.length,
  };
}

/**
 * @returns {Promise<boolean>} true when a REAL kickoff puts us in a live window.
 */
export async function isLiveWindow(sql, leagueId, now = new Date(), { log = null } = {}) {
  const { live } = await liveWindowDetail(sql, leagueId, now, { log });
  return live;
}

/**
 * The same decision with its working shown. The cron logs this so a
 * late-September Saturday visibly reports the rule operating rather than
 * silently returning false.
 */
export async function liveWindowDetail(sql, leagueId, now = new Date(), { log = null } = {}) {
  const lo = new Date(now.getTime() - LIVE_WINDOW_POST_HOURS * 3600_000).toISOString(); // now - 5h
  const hi = new Date(now.getTime() + LIVE_WINDOW_PRE_MIN * 60_000).toISOString();       // now + 45min
  const rows = await sql`
    SELECT m.kickoff_at, m.status
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
     WHERE m.league_id = ${leagueId}
       AND l.sport = 'football'
       AND m.kickoff_at BETWEEN ${lo} AND ${hi}
       AND m.status NOT IN ('final', 'postponed', 'cancelled')`;
  const out = classifyWindowRows(rows);
  if (out.tbdExcluded > 0 && typeof log === 'function') {
    log('liveWindow: TBD placeholders excluded', {
      leagueId, considered: out.considered, tbd_excluded: out.tbdExcluded, live: out.live,
    });
  }
  return out;
}
