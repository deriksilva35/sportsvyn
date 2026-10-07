// lib/leagues/rollover.js - a league's SEASON ROLLOVER for its Pick'em format (S2).
//
// A QUEUED FORMAT APPLIES WHEN THE NEXT SEASON'S BOARD IS CREATED (wed-3), in
// the same step that stamps a board's scoring: ensurePickemBoard, the NBA day
// board and the MLB series board each call rolloverAfterCreate right after
// their INSERT wins. Never on a read - a page view changes nothing.
//
// A league has no season row. Its CURRENT season, in the new board's sport, is
// the season_year of the first board of that sport locking at or after the
// moment the current format took effect (pick_format_from when a switch or an
// earlier rollover set one, else starts_at). Season years are per sport. The
// new board starts the next season when its season_year is later than that.
//
// ONE UPDATE per league: pick_format = pending, pick_format_prev = the old
// format, pick_format_from = the new season's FIRST board's lock (so the old
// season stays as it was scored, and a rollover that only lands on a later
// board of the season still starts at the season's first), pending = NULL.
// Guarded on the pending value it read: a second call or a race changes nothing.
// Any board of the new season retries a rollover an earlier one missed.

import { sql } from '../db.js';

/**
 * board: { sport, seasonYear } of the Pick'em board just created.
 * -> [{ leagueId, pickFormat, from }] the leagues that switched.
 */
export async function applyPendingFormatsForBoard({ sport, seasonYear } = {}) {
  if (!sport || seasonYear == null) return [];
  const due = await sql`
    WITH lg AS (
      SELECT l.id, l.pick_format_pending AS pending,
             GREATEST(l.starts_at, l.pick_format_from) AS anchor
        FROM player_leagues l
        JOIN player_league_games g ON g.league_id = l.id AND g.game_type = 'pickem' AND g.sport = ${sport}
       WHERE l.pick_format_pending IS NOT NULL
    )
    SELECT lg.id, lg.pending,
           (SELECT c.season_year FROM contests c
             WHERE c.game_type = 'pickem' AND c.sport = ${sport}
               AND (lg.anchor IS NULL OR c.locks_at >= lg.anchor)
             ORDER BY c.locks_at LIMIT 1) AS base,
           (SELECT min(c.locks_at) FROM contests c
             WHERE c.game_type = 'pickem' AND c.sport = ${sport} AND c.season_year = ${seasonYear}) AS season_from
      FROM lg`;
  const out = [];
  for (const d of due) {
    if (d.base == null || !(Number(seasonYear) > Number(d.base)) || d.season_from == null) continue;
    const from = new Date(d.season_from).toISOString();
    const rows = await sql`
      UPDATE player_leagues
         SET pick_format_prev = pick_format, pick_format = pick_format_pending,
             pick_format_from = ${from}::timestamptz, pick_format_pending = NULL
       WHERE id = ${d.id} AND pick_format_pending = ${d.pending}
      RETURNING id, pick_format`;
    if (rows[0]) out.push({ leagueId: Number(rows[0].id), pickFormat: rows[0].pick_format, from });
  }
  return out;
}

/**
 * The creators' call: a rollover failure never fails the board. A miss is
 * retried by the next board of the season (see above).
 */
export async function rolloverAfterCreate(board) {
  try {
    return await applyPendingFormatsForBoard(board);
  } catch (e) {
    console.error(`[league-rollover] ${board?.sport} ${board?.seasonYear}: ${e?.message ?? e}`);
    return [];
  }
}
