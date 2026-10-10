// lib/draftGame/pool.js - one game's draft pool: both teams' active players (thu-3 S1).
//
// WHO IS IN IT. Every nfl_players row on either team (team_id = home or away),
// position QB/RB/WR/TE (players only - no K, no DST, ruling), that has PLAYED:
// at least one final game in the 365 days before this kickoff. A name on a
// roster that never takes the field is not a pick anybody should be offered.
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
export const POOL_MAX = 30;
export const POOL_MIN = TOTAL_PICKS + 4;
/** A projection under this is a body, not a pick (special teams, a garbage-time snap). */
export const PROJ_FLOOR = 0.5;
const ACTIVE_DAYS = 365;

/**
 * The frozen board rows for one NFL match, best projection first:
 * [{ id, name, pos, team, team_id, proj, games }]. PURE over `stats` rows
 * (one per player-game, newest first per player) and `players`.
 */
export function shapePool(players, stats, { max = POOL_MAX } = {}) {
  const lines = new Map();
  for (const r of stats) {
    const id = Number(r.nfl_player_id);
    const arr = lines.get(id) ?? [];
    if (arr.length < PROJ_GAMES) arr.push(fantasyPoints(toStatLine(r), 'ppr'));
    lines.set(id, arr);
  }
  const rows = [];
  for (const p of players) {
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
  return shapePool(players, stats);
}
