// lib/daily/close.js - closing a Daily, and reading a closed one.
//
// CLOSING IS ONE STATEMENT, GUARDED. `UPDATE ... WHERE NOT revealed` is what
// makes a second tick a no-op rather than a recomputation, and it is the same
// shape as the final_seen_at set-once stamp for the same reason: the job runs
// every fifteen minutes and must be safe to run twice in one.

import { sql } from '../db.js';
import { perfectLineup, tierFor, guessResult, isDnf, statLine } from './reveal.js';
import { scoreLineup } from './play.js';
import { toStatLine } from '../fantasy/playerStats.js';

/**
 * Box-score lines for one week, keyed by our player id.
 *
 * READ AT REVEAL RENDER, NEVER STORED ON THE BOARD. Freezing these would mean
 * regenerating every board and would put the answer inside a row that is served
 * - through publicBoard() - while the day is still open. Reading them here
 * keeps the pre-close payload exactly as it was.
 *
 * One query for the whole board rather than sixty-four. REG only and scoped to
 * the drawn (season, week), matching how the board itself was built.
 */
async function boxScoreIndex(season, week, playerIds) {
  if (!playerIds?.length) return new Map();
  const rows = await sql`
    SELECT s.nfl_player_id,
           s.pass_cmp, s.pass_att, s.pass_yds, s.pass_td, s.pass_int,
           s.rush_att, s.rush_yds, s.rush_td,
           s.tgt, s.rec, s.rec_yds, s.rec_td, s.fumbles_lost
      FROM nfl_player_game_stats s
      JOIN matches m ON m.id = s.match_id
      JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_year = ${season} AND m.week = ${week}
       AND m.season_phase = 'REG'
       AND s.nfl_player_id = ANY(${playerIds})`;
  return new Map(rows.map((r) => [r.nfl_player_id, toStatLine(r)]));
}

/** Attach `line` to a list of rows carrying { id, pos }. Non-mutating. */
const withLines = (rows, index) => (rows ?? []).map((p) => ({
  ...p, line: statLine(p.pos, index.get(p.id)) ?? null,
}));

/**
 * Close one day: compute the perfect lineup, freeze it, flip revealed.
 *
 * The perfect lineup is stored on the row rather than recomputed per reader.
 * Brute force is 300ms on a 64-player board - fine once at close, wasteful on
 * every page view, and storing it means the badge a player screenshots cannot
 * drift from the one the next reader sees.
 */
export async function closeDay(puzzleDate) {
  const rows = await sql`SELECT puzzle_date, board, revealed FROM puzzle_days WHERE puzzle_date = ${puzzleDate}`;
  const day = rows[0];
  if (!day) return { puzzle_date: puzzleDate, error: 'no such day' };
  if (day.revealed) return { puzzle_date: puzzleDate, alreadyRevealed: true };

  const perfect = perfectLineup(day.board);
  const upd = await sql`
    UPDATE puzzle_days
       SET revealed = true, perfect = ${JSON.stringify(perfect)}::jsonb
     WHERE puzzle_date = ${puzzleDate} AND NOT revealed
     RETURNING puzzle_date`;
  if (!upd.length) return { puzzle_date: puzzleDate, alreadyRevealed: true };

  const counts = await sql`
    SELECT count(*) FILTER (WHERE locked_at IS NOT NULL)::int AS entries,
           count(*) FILTER (WHERE locked_at IS NULL)::int AS dnf
      FROM puzzle_entries WHERE puzzle_date = ${puzzleDate}`;
  return {
    puzzle_date: puzzleDate, revealed: true,
    perfect: perfect?.total ?? null,
    entries: counts[0].entries, dnf: counts[0].dnf,
  };
}

/**
 * Everything a closed day shows. PUBLIC: no auth needed to read the answer once
 * the day is over - that is the whole point of a reveal, and it is what lets
 * the share card be fetched by someone who has not played.
 *
 * `userId` is optional and only adds the caller's own breakdown.
 */
export async function revealView(puzzleDate, userId = null) {
  const rows = await sql`SELECT * FROM puzzle_days WHERE puzzle_date = ${puzzleDate}`;
  const day = rows[0];
  if (!day) return { state: 'missing' };
  if (!day.revealed && new Date(day.closes_at).getTime() > Date.now()) return { state: 'open' };

  // board is always the player array. perfect is stored at close; computed on
  // the fly only if a reader beats the close job to the page, which the */15
  // tick makes unlikely but not impossible.
  const players = day.board;
  const perfect = day.perfect ?? perfectLineup(players);

  const box = await boxScoreIndex(day.season_year, day.week, players.map((p) => p.id));

  const out = {
    state: 'revealed',
    puzzleDate,
    season: day.season_year,
    week: day.week,
    perfect: perfect ? { ...perfect, picks: withLines(perfect.picks, box) } : perfect,
    board: withLines([...players].sort((a, b) => b.points - a.points), box),
  };

  if (userId != null) {
    const e = (await sql`SELECT * FROM puzzle_entries WHERE user_id = ${userId} AND puzzle_date = ${puzzleDate}`)[0];
    if (e && isDnf(e)) {
      out.you = { dnf: true };
    } else if (e) {
      const breakdown = scoreLineup(e.lineup, players);
      const others = await sql`
        SELECT score FROM puzzle_entries WHERE puzzle_date = ${puzzleDate} AND locked_at IS NOT NULL AND score IS NOT NULL`;
      out.you = {
        dnf: false,
        score: Number(e.score), baseScore: Number(e.base_score), bonusPct: Number(e.bonus_pct),
        picks: withLines(breakdown.picks, box), droppedSlot: breakdown.droppedSlot,
        tier: tierFor(e.score, perfect?.total),
        guess: guessResult(e, day),
        entrants: others.length,
      };
    }
  }
  return out;
}
