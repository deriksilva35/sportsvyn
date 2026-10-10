// lib/draftGame/pool.js - one game's draft pool: both teams' active players (thu-3 S1).
//
// WHO IS IN IT. Every nfl_players row on either team (team_id = home or away),
// position QB/RB/WR/TE (players only - no K, no DST, ruling), who PLAYED IN ONE
// OF HIS TEAM'S LAST 3 GAMES (sat-1): a stat row in one of the team's three most
// recent finals before this kickoff that have a box. A name on a roster that has
// not taken the field lately - hurt, inactive, cut - is not a pick anybody
// should be offered. The receipt is A.J. Brown: on NE, played week 1, nothing
// since, and the old "any game in 365 days" rule would have kept him.
//
// "THAT HAVE A BOX": a final whose stats never landed is skipped rather than
// counted, so one missing box cannot empty a team's pool. Byes need no rule -
// these are the team's games, not the calendar's weeks.
//
// INJURIES: we hold no per-player injury status. BDL's NFL injury feed only
// reaches us as news headlines (lib/wire/injuries.js -> news_items), so there
// is nothing structured to filter on; the last-3 rule stands alone until a
// status table exists.
//
// PROJECTION = his average PPR over his last PROJ_GAMES finals before this
// kickoff (any season), from nfl_player_game_stats through the one scorer
// (lib/fantasy/scoring.js). It orders the board, drives the bots and is what an
// expired clock auto-picks. It is a ranking, not a promise: the game is scored
// on what happens.
//
// THE POOL IS CAPPED at POOL_MAX by projection - a 4x4 room needs 16, and a
// board of 50 special-teamers buries the real choices - and REFUSED below
// POOL_MIN, which leaves 4 spare after the last pick. A refused game gets no
// board (lib/draftGame/create.js records why).

import { sql as defaultSql } from '../db.js';
import { fantasyPoints } from '../fantasy/scoring.js';
import { toStatLine } from '../fantasy/playerStats.js';
import { NFL_POSITIONS, TOTAL_PICKS, byProjection } from './rules.js';

export const PROJ_GAMES = 8;
/** A player must have played in one of his team's last this-many games (with a box). */
export const RECENT_TEAM_GAMES = 3;
export const POOL_MAX = 30;
export const POOL_MIN = TOTAL_PICKS + 4;
/** A projection under this is a body, not a pick (special teams, a garbage-time snap). */
export const PROJ_FLOOR = 0.5;
const ACTIVE_DAYS = 365;

/**
 * The frozen board rows for one NFL match, best projection first:
 * [{ id, name, pos, team, team_id, proj, games }]. PURE over `stats` rows
 * (one per player-game, newest first per player) and `players`; `active` (a
 * Set of player ids), when given, is who may appear at all.
 */
export function shapePool(players, stats, { max = POOL_MAX, active = null } = {}) {
  const lines = new Map();
  for (const r of stats) {
    const id = Number(r.nfl_player_id);
    const arr = lines.get(id) ?? [];
    if (arr.length < PROJ_GAMES) arr.push(fantasyPoints(toStatLine(r), 'ppr'));
    lines.set(id, arr);
  }
  const rows = [];
  for (const p of players) {
    if (active && !active.has(Number(p.id))) continue;
    const pts = lines.get(Number(p.id));
    if (!pts?.length) continue;
    const proj = Math.round((pts.reduce((a, b) => a + b, 0) / pts.length) * 10) / 10;
    if (proj < PROJ_FLOOR) continue;
    rows.push({ id: Number(p.id), name: p.full_name, pos: p.position, team: p.abbreviation, team_id: Number(p.team_id), proj, games: pts.length });
  }
  return byProjection(rows).slice(0, max);
}

/** Build one NFL match's pool from the database. `match` needs id, kickoff_at, home_team_id, away_team_id. */
export async function buildNflPool(match, { sql = defaultSql } = {}) {
  const teams = [Number(match.home_team_id), Number(match.away_team_id)];
  const kickoff = new Date(match.kickoff_at).toISOString();
  const players = await sql`
    SELECT p.id, p.full_name, p.position, p.team_id, t.abbreviation
      FROM nfl_players p JOIN teams t ON t.id = p.team_id
     WHERE p.team_id = ANY(${teams}) AND p.position = ANY(${[...NFL_POSITIONS]})
       AND NOT p.is_team_defense`;
  if (!players.length) return [];
  const ids = players.map((p) => Number(p.id));
  const stats = await sql`
    SELECT s.nfl_player_id, s.pass_cmp, s.pass_att, s.pass_yds, s.pass_td, s.pass_int,
           s.rush_att, s.rush_yds, s.rush_td, s.tgt, s.rec, s.rec_yds, s.rec_td, s.fumbles_lost
      FROM nfl_player_game_stats s JOIN matches m ON m.id = s.match_id
     WHERE s.nfl_player_id = ANY(${ids}) AND m.status = 'final'
       AND m.kickoff_at < ${kickoff}
       AND m.kickoff_at >= ${kickoff}::timestamptz - make_interval(days => ${ACTIVE_DAYS})
     ORDER BY s.nfl_player_id, m.kickoff_at DESC`;
  const active = await recentlyActive(players, teams, kickoff, sql);
  return shapePool(players, stats, { active });
}

/**
 * The players (of `players`) with a stat row in one of THEIR team's last
 * RECENT_TEAM_GAMES finals before `kickoff` that have a box. A Set of ids.
 */
export async function recentlyActive(players, teams, kickoff, sql = defaultSql) {
  const recent = await sql`
    SELECT m.id, m.home_team_id, m.away_team_id
      FROM matches m
     WHERE m.status = 'final' AND m.kickoff_at < ${kickoff}
       AND (m.home_team_id = ANY(${teams}) OR m.away_team_id = ANY(${teams}))
       AND EXISTS (SELECT 1 FROM nfl_player_game_stats s WHERE s.match_id = m.id)
     ORDER BY m.kickoff_at DESC
     LIMIT ${RECENT_TEAM_GAMES * 4}`;
  const lastFor = new Map(teams.map((t) => [t, []]));
  for (const m of recent) {
    for (const t of [Number(m.home_team_id), Number(m.away_team_id)]) {
      const arr = lastFor.get(t);
      if (arr && arr.length < RECENT_TEAM_GAMES) arr.push(Number(m.id));
    }
  }
  const pairs = players.map((p) => ({ id: Number(p.id), games: lastFor.get(Number(p.team_id)) ?? [] }))
    .filter((x) => x.games.length);
  if (!pairs.length) return new Set();
  const allGames = [...new Set(pairs.flatMap((x) => x.games))];
  const rows = await sql`
    SELECT DISTINCT nfl_player_id, match_id FROM nfl_player_game_stats
     WHERE match_id = ANY(${allGames}) AND nfl_player_id = ANY(${pairs.map((x) => x.id)})`;
  const played = new Set(rows.map((r) => `${r.nfl_player_id}:${r.match_id}`));
  return new Set(pairs.filter((x) => x.games.some((g) => played.has(`${x.id}:${g}`))).map((x) => x.id));
}
