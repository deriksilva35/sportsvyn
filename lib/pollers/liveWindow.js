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
 */

import { LIVE_WINDOW_PRE_MIN, LIVE_WINDOW_POST_HOURS } from './cadence.js';

export async function isLiveWindow(sql, leagueId, now = new Date()) {
  const lo = new Date(now.getTime() - LIVE_WINDOW_POST_HOURS * 3600_000).toISOString(); // now - 5h
  const hi = new Date(now.getTime() + LIVE_WINDOW_PRE_MIN * 60_000).toISOString();       // now + 45min
  const rows = await sql`
    SELECT 1
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
     WHERE m.league_id = ${leagueId}
       AND l.sport = 'football'
       AND m.kickoff_at BETWEEN ${lo} AND ${hi}
       AND m.status NOT IN ('final', 'postponed', 'cancelled')
     LIMIT 1`;
  return rows.length > 0;
}
