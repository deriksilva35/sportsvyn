// lib/scores/statsRead.js - what the Stats tab reads for one league and one day.
//
// TWO ROUND TRIPS, NOT A FAN-OUT: the day's games (ET calendar day, the Games
// tab's day), then every stat row for those games in one query. Football also
// reads the DST sums in one grouped query (a team defense has no row of its own;
// lib/fantasy/playerStats.js derives it from its defenders the same way).
//
// JSON IN, JSON OUT: the cached wrapper (statsCached.js) stores this result in
// Next's data cache, so nothing here is a Map or a Date.

import { sql as defaultSql } from '../db.js';

const ET = 'America/New_York';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The league's live and final games on an ET calendar day, plus the day's game count. */
export async function dayGames(league, date, { sql = defaultSql } = {}) {
  if (!DAY_RE.test(date ?? '')) return { total: 0, games: [] };
  const rows = await sql`
    SELECT m.id, m.status, m.kickoff_at,
           m.metadata->'live_state' AS ls,
           CASE WHEN l.slug = 'nba' THEN m.metadata->'detail'->'line_score' ELSE NULL END AS line_score,
           h.id AS home_id, h.abbreviation AS home_abbr, h.short_name AS home_short, h.name AS home_name,
           h.color_primary AS home_c1, h.color_secondary AS home_c2,
           a.id AS away_id, a.abbreviation AS away_abbr, a.short_name AS away_short, a.name AS away_name,
           a.color_primary AS away_c1, a.color_secondary AS away_c2
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      JOIN teams h ON h.id = m.home_team_id
      JOIN teams a ON a.id = m.away_team_id
     WHERE l.slug = ${league}
       AND m.status IN ('live', 'final')
       AND (m.kickoff_at AT TIME ZONE ${ET})::date = ${date}::date
     ORDER BY m.kickoff_at, m.id`;
  const total = await sql`
    SELECT count(*)::int AS n FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ${league} AND m.status <> 'not_needed'
       AND (m.kickoff_at AT TIME ZONE ${ET})::date = ${date}::date`;
  return {
    total: total[0]?.n ?? rows.length,
    games: rows.map((r) => ({
      id: Number(r.id), status: r.status, ls: r.ls ?? null, lineScore: r.line_score ?? null,
      homeId: Number(r.home_id), awayId: Number(r.away_id),
      homeAbbr: r.home_abbr, awayAbbr: r.away_abbr,
      homeName: r.home_short ?? r.home_name, awayName: r.away_short ?? r.away_name,
      homeC1: r.home_c1, homeC2: r.home_c2, awayC1: r.away_c1, awayC2: r.away_c2,
    })),
  };
}

/** NFL: the fantasy positions' rows plus a derived DST row per team per game. */
export async function nflStats(matchIds, { sql = defaultSql } = {}) {
  if (!matchIds.length) return [];
  const players = await sql`
    SELECT s.match_id, s.nfl_player_id, COALESCE(s.team_id, np.team_id) AS team_id,
           np.full_name AS name, np.position,
           s.pass_cmp, s.pass_att, s.pass_yds, s.pass_td, s.pass_int,
           s.rush_att, s.rush_yds, s.rush_td, s.tgt, s.rec, s.rec_yds, s.rec_td,
           s.fumbles_lost, s.fgm, s.fga, s.xp
      FROM nfl_player_game_stats s
      JOIN nfl_players np ON np.id = s.nfl_player_id
     WHERE s.match_id = ANY(${matchIds}) AND np.position IN ('QB', 'RB', 'WR', 'TE', 'PK')`;
  const dst = await sql`
    SELECT s.match_id, s.team_id, 'DEF' AS position,
           sum(s.sacks) AS sacks, sum(s.def_int) AS def_int, sum(s.fr) AS fr, sum(s.def_td) AS def_td
      FROM nfl_player_game_stats s
     WHERE s.match_id = ANY(${matchIds}) AND s.team_id IS NOT NULL
     GROUP BY s.match_id, s.team_id`;
  return [...players, ...dst];
}

/** NBA: every played line, keyed on the BDL player id (there is no players table). */
export async function nbaStats(matchIds, { sql = defaultSql } = {}) {
  if (!matchIds.length) return [];
  return sql`
    SELECT match_id, team_id, bdl_player_id, player_name, position, seconds, dnp,
           pts, fgm, fga, fg3m, ftm, fta, reb, ast, stl, blk, turnovers
      FROM nba_player_game_stats
     WHERE match_id = ANY(${matchIds}) AND NOT dnp`;
}

/** One league-day, JSON-safe: { total, games, stats }. */
export async function readStatsDay(league, date, { sql = defaultSql } = {}) {
  const { games, total } = await dayGames(league, date, { sql });
  const ids = games.map((g) => g.id);
  const stats = league === 'nba' ? await nbaStats(ids, { sql }) : await nflStats(ids, { sql });
  return { total, games, stats: JSON.parse(JSON.stringify(stats)) };
}
