// lib/leagues/rollover.js - a league's SEASON ROLLOVER for its Pick'em format (S2).
//
// There is no rollover job: a league has no season row. Its season is the
// season_year of the first Pick'em board that locks at or after its starts_at,
// and the next season has begun the moment a Pick'em board of a LATER
// season_year exists. applyPendingPickFormat is called where those boards are
// first resolved - leagueDetail (the league page, cards) and loadLeagueResults
// (the table) - so the first read of the new season applies it.
//
// ONE UPDATE: pick_format = pending, pick_format_prev = the old format,
// pick_format_from = the new season's first lock (so the old season stays as it
// was scored), pending = NULL. It is guarded on the pending value it read, so a
// second call (or a race) finds nothing queued and changes nothing.

import { sql } from '../db.js';

/** -> the league fields that changed ({} when nothing was due). */
export async function applyPendingPickFormat(lg) {
  const pending = lg?.pick_format_pending;
  if (!pending) return {};
  const [season] = await sql`
    WITH b AS (
      SELECT c.season_year, c.locks_at
        FROM contests c
        JOIN player_league_games g ON g.league_id = ${lg.id} AND g.game_type = 'pickem'
                                  AND g.game_type = c.game_type AND g.sport = c.sport
       WHERE (${lg.starts_at ?? null}::timestamptz IS NULL OR c.locks_at >= ${lg.starts_at ?? null}::timestamptz)
    )
    SELECT (SELECT min(season_year) FROM b) AS base,
           (SELECT min(locks_at) FROM b WHERE season_year > (SELECT min(season_year) FROM b)) AS next_from`;
  if (!season?.next_from) return {};
  const from = new Date(season.next_from).toISOString();
  const rows = await sql`
    UPDATE player_leagues
       SET pick_format_prev = pick_format, pick_format = pick_format_pending,
           pick_format_from = ${from}::timestamptz, pick_format_pending = NULL
     WHERE id = ${lg.id} AND pick_format_pending = ${pending}
    RETURNING pick_format, pick_format_prev, pick_format_from, pick_format_pending`;
  return rows[0] ?? {};
}
