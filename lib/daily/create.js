// lib/daily/create.js - the DB half of making a Daily. The decision half is
// pool.js, which is pure; this file only fetches, calls it, and writes.
//
// RESUME DATA COMES FROM nflverse players.csv, which is a 7MB file we already
// cache to disk. It is read ONCE per invocation and reused across both days.
// The fields taken from it - college and draft slot - are the ones that do not
// tell you what year it is; see resumeLine() for why career span is excluded.

import { sql } from '../db.js';
import { toStatLine } from '../fantasy/playerStats.js';
import { fantasyPoints } from '../fantasy/scoring.js';
import { loadPlayers } from '../gridiron/nflverse.js';
import { seedFor, makeRng, drawWeek, buildBoard, resumeLine, PPR_FLOOR, POOL_SHAPE } from './pool.js';

const SEASON_LO = 2015;
const SEASON_HI = 2024;

/** Every (season, week) the corpus can serve. */
export async function candidateWeeks() {
  return sql`
    SELECT DISTINCT m.season_year, m.week
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_phase = 'REG'
       AND m.season_year BETWEEN ${SEASON_LO} AND ${SEASON_HI}
       AND m.week IS NOT NULL
     ORDER BY m.season_year, m.week`;
}

/** Players who cleared the floor in one week, with everything the board needs. */
export async function eligibleFor(season, week, resumeByPlayer) {
  const rows = await sql`
    SELECT np.id AS nfl_player_id, np.full_name, np.bdl_player_id, ps.position, t.abbreviation AS team,
           s.pass_cmp, s.pass_att, s.pass_yds, s.pass_td, s.pass_int,
           s.rush_att, s.rush_yds, s.rush_td,
           s.tgt, s.rec, s.rec_yds, s.rec_td, s.fumbles_lost,
           s.fgm, s.fga, s.fg_long, s.xp
      FROM nfl_player_game_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN nfl_players np ON np.id = s.nfl_player_id
      JOIN nfl_player_seasons ps ON ps.nfl_player_id = s.nfl_player_id AND ps.season_year = m.season_year
      JOIN teams t ON t.id = s.team_id
      JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_year = ${season} AND m.week = ${week}
       AND m.season_phase = 'REG' AND ps.position = ANY(${Object.keys(POOL_SHAPE)})`;

  const out = [];
  for (const r of rows) {
    const points = fantasyPoints(toStatLine(r), 'ppr');
    if (points < PPR_FLOOR) continue;
    const meta = resumeByPlayer?.get(r.nfl_player_id) ?? {};
    out.push({
      nfl_player_id: r.nfl_player_id,
      name: r.full_name,
      position: r.position,
      team: r.team,
      points,
      resume: resumeLine({ college: meta.college, draftRound: meta.draftRound, draftPick: meta.draftPick }),
    });
  }
  return out;
}

/**
 * players.csv keyed by OUR player id, via the gsis_id already stored on
 * nfl_player_seasons by the position import. Joining on gsis rather than name
 * for the same reason that import does: 4% of nflverse rows carry a different
 * name in the per-season roster than in the master.
 */
export async function resumeIndex() {
  const [players, links] = await Promise.all([
    loadPlayers(),
    sql`SELECT DISTINCT nfl_player_id, gsis_id FROM nfl_player_seasons WHERE gsis_id IS NOT NULL`,
  ]);
  const byGsis = new Map(players.map((p) => [p.gsis_id, p]));
  const out = new Map();
  for (const l of links) {
    const p = byGsis.get(l.gsis_id);
    if (!p) continue;
    out.set(l.nfl_player_id, {
      college: p.college_name || null,
      draftRound: p.draft_round ? Number(p.draft_round) : null,
      draftPick: p.draft_pick ? Number(p.draft_pick) : null,
    });
  }
  return out;
}

/**
 * Create the row for one ET date if it is not already there.
 *
 * Returns { puzzle_date, created, season_year?, week?, error? }. Never throws
 * for a business reason - the cron reports failures per day and alerts, rather
 * than losing tomorrow because today could not be built.
 */
export async function ensurePuzzleDay(puzzleDate, { resumeByPlayer = null } = {}) {
  const existing = await sql`SELECT puzzle_date FROM puzzle_days WHERE puzzle_date = ${puzzleDate}`;
  if (existing.length) return { puzzle_date: puzzleDate, created: false };

  const secret = process.env.PUZZLE_SEED;
  if (!secret) return { puzzle_date: puzzleDate, created: false, error: 'PUZZLE_SEED not set' };

  const seed = seedFor(puzzleDate, secret);
  const rng = makeRng(seed);
  const [candidates, used] = await Promise.all([
    candidateWeeks(),
    sql`SELECT season_year, week FROM puzzle_days`,
  ]);
  const pick = drawWeek(candidates, used, rng);
  if (!pick) return { puzzle_date: puzzleDate, created: false, error: 'no candidate weeks' };

  const resume = resumeByPlayer ?? await resumeIndex();
  const eligible = await eligibleFor(pick.season_year, pick.week, resume);
  const built = buildBoard(eligible, rng);
  if (!built.ok) {
    return { puzzle_date: puzzleDate, created: false, error: `${built.reason} ${JSON.stringify(built.short)}` };
  }

  // opens/closes at ET midnight, computed DST-aware in Postgres. ON CONFLICT DO
  // NOTHING is the race guard: two ticks in the same second cannot both insert.
  const ins = await sql`
    INSERT INTO puzzle_days (puzzle_date, season_year, week, seed, board, opens_at, closes_at)
    VALUES (
      ${puzzleDate}, ${pick.season_year}, ${pick.week}, ${seed}, ${JSON.stringify(built.board)}::jsonb,
      (${puzzleDate}::timestamp AT TIME ZONE 'America/New_York'),
      ((${puzzleDate}::date + 1)::timestamp AT TIME ZONE 'America/New_York')
    )
    ON CONFLICT (puzzle_date) DO NOTHING
    RETURNING puzzle_date`;

  return {
    puzzle_date: puzzleDate,
    created: ins.length > 0,
    season_year: pick.season_year,
    week: pick.week,
    recycled: pick.recycled,
    boardSize: built.board.length,
  };
}
