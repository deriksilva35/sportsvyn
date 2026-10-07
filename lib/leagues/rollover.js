// lib/leagues/rollover.js - a league's SEASON ROLLOVER for its Pick'em format (S2).
//
// There is no rollover job: a league has no season row. The CURRENT season is
// the season_year of the first Pick'em board that locks at or after the moment
// the current format took effect - pick_format_from when a switch or an earlier
// rollover set one, else the league's starts_at - so a league in its second
// season is measured from its second season, not its first. The next season
// has begun the moment a board of THE SAME SPORT with a LATER season_year
// exists (season years are per sport; an NBA 2027 board says nothing about
// the NFL season). applyPendingPickFormat is called where those boards are
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
  const anchor = [lg.starts_at, lg.pick_format_from].filter((v) => v != null)
    .map((v) => new Date(v)).sort((x, y) => y - x)[0] ?? null;
  const [season] = await sql`
    WITH b AS (
      SELECT c.sport, c.season_year, c.locks_at
        FROM contests c
        JOIN player_league_games g ON g.league_id = ${lg.id} AND g.game_type = 'pickem'
                                  AND g.game_type = c.game_type AND g.sport = c.sport
    ), base AS (
      SELECT sport, season_year FROM b
       WHERE (${anchor?.toISOString() ?? null}::timestamptz IS NULL OR locks_at >= ${anchor?.toISOString() ?? null}::timestamptz)
       ORDER BY locks_at LIMIT 1
    )
    SELECT (SELECT min(b.locks_at) FROM b, base
             WHERE b.sport = base.sport AND b.season_year > base.season_year) AS next_from`;
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
