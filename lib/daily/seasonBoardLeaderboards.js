// lib/daily/seasonBoardLeaderboards.js — the six v2 leaderboards, all read
// models over daily_board_runs (standing ruling: only the Daily feeds a
// public board - preview and practice never write that table, so there is
// nothing here to exclude by game-mode; every row in daily_board_runs is
// already Daily-only by construction).
//
// EVERY QUERY SORTS SERVER-SIDE, WITH THE TIEBREAK IN THE ORDER BY - the
// header printed above a leaderboard is a promise about what order the rows
// are in, and a promise a JS .sort() could silently break is a promise this
// file keeps in SQL instead. Rank is DENSE_RANK() OVER (ORDER BY <primary>) -
// dense by the PRIMARY value alone; the tiebreak columns only decide row
// ORDER among an already-tied rank, never open up a new rank of their own.
//
// pct IS numeric (Postgres exact decimal), NEVER cast to float anywhere in
// this file - `pct >= 1` for the perfect-boards board is an EXACT compare
// with no epsilon, because there is nothing here that could introduce one.

import { displayName } from './handles.js';

function withHandle(rows) {
  return rows.map((r) => ({ ...r, handle: displayName({ id: r.userId, handle: r.rawHandle }) }));
}

/**
 * MAIN: avg pct over a player's last 30 edition runs, minimum 10 runs.
 * Secondary = avg matched. Ties: pct, then matched, then earliest
 * qualifying run (the oldest of the 30 runs the average was computed over).
 */
export async function mainLeaderboard(sql) {
  const rows = await sql`
    WITH ranked AS (
      SELECT r.user_id, r.pct, r.matched, b.edition_date,
             row_number() OVER (PARTITION BY r.user_id ORDER BY b.edition_date DESC) AS rn
        FROM daily_board_runs r JOIN daily_boards b ON b.id = r.board_id
    ),
    last30 AS (SELECT * FROM ranked WHERE rn <= 30),
    agg AS (
      SELECT user_id, avg(pct) AS avg_pct, avg(matched) AS avg_matched,
             count(*) AS n, min(edition_date) AS earliest
        FROM last30 GROUP BY user_id HAVING count(*) >= 10
    )
    SELECT a.user_id, a.avg_pct, a.avg_matched, a.n, to_char(a.earliest, 'YYYY-MM-DD') AS earliest,
           u.handle AS raw_handle,
           dense_rank() OVER (ORDER BY a.avg_pct DESC) AS rank
      FROM agg a JOIN users u ON u.id = a.user_id
     ORDER BY a.avg_pct DESC, a.avg_matched DESC, a.earliest ASC`;
  return withHandle(rows.map((r) => ({
    rank: r.rank, userId: r.user_id, rawHandle: r.raw_handle,
    primary: Number(r.avg_pct), secondary: Number(r.avg_matched), runsPlayed: Number(r.n), earliest: r.earliest,
  })));
}

/**
 * TODAY: raw score for ONE board. Secondary = matched. Ties: matched, then
 * completed_at (earliest finish wins the tie).
 */
export async function todayLeaderboard(sql, boardId) {
  const rows = await sql`
    SELECT r.user_id, r.score, r.matched, r.completed_at, u.handle AS raw_handle,
           dense_rank() OVER (ORDER BY r.score DESC) AS rank
      FROM daily_board_runs r JOIN users u ON u.id = r.user_id
     WHERE r.board_id = ${boardId}
     ORDER BY r.score DESC, r.matched DESC, r.completed_at ASC`;
  return withHandle(rows.map((r) => ({
    rank: r.rank, userId: r.user_id, rawHandle: r.raw_handle,
    primary: Number(r.score), secondary: r.matched, completedAt: r.completed_at,
  })));
}

/**
 * STREAK: current consecutive edition dates ending today or yesterday (ET -
 * the caller supplies todayEtDate, never computed here). Secondary =
 * longest ever. Classic gaps-and-islands: edition_date minus its own
 * row_number (in date order) is constant within one consecutive run, so
 * grouping on that difference isolates every island in one pass.
 */
export async function streakLeaderboard(sql, todayEtDate) {
  const rows = await sql`
    WITH played AS (
      SELECT DISTINCT r.user_id, b.edition_date
        FROM daily_board_runs r JOIN daily_boards b ON b.id = r.board_id
    ),
    islands AS (
      SELECT user_id, edition_date,
             edition_date - (row_number() OVER (PARTITION BY user_id ORDER BY edition_date))::int AS grp
        FROM played
    ),
    lengths AS (
      SELECT user_id, grp, count(*) AS len, max(edition_date) AS last_date
        FROM islands GROUP BY user_id, grp
    ),
    per_user AS (
      SELECT user_id,
             max(len) AS longest,
             coalesce(max(len) FILTER (
               WHERE last_date = ${todayEtDate}::date OR last_date = ${todayEtDate}::date - 1
             ), 0) AS current
        FROM lengths GROUP BY user_id
    )
    SELECT p.user_id, p.current, p.longest, u.handle AS raw_handle,
           dense_rank() OVER (ORDER BY p.current DESC) AS rank
      FROM per_user p JOIN users u ON u.id = p.user_id
     WHERE p.current > 0
     ORDER BY p.current DESC, p.longest DESC`;
  return withHandle(rows.map((r) => ({
    rank: r.rank, userId: r.user_id, rawHandle: r.raw_handle,
    primary: Number(r.current), secondary: Number(r.longest),
  })));
}

/** PERFECT: count of runs with pct >= 1.0, exact numeric compare. */
export async function perfectLeaderboard(sql) {
  const rows = await sql`
    SELECT r.user_id, count(*) AS n, u.handle AS raw_handle,
           dense_rank() OVER (ORDER BY count(*) DESC) AS rank
      FROM daily_board_runs r JOIN users u ON u.id = r.user_id
     WHERE r.pct >= 1
     GROUP BY r.user_id, u.handle
     ORDER BY n DESC`;
  return withHandle(rows.map((r) => ({
    rank: r.rank, userId: r.user_id, rawHandle: r.raw_handle, primary: Number(r.n), secondary: null,
  })));
}

/** PLAYED: pure volume, no judgment - count of runs. */
export async function playedLeaderboard(sql) {
  const rows = await sql`
    SELECT r.user_id, count(*) AS n, u.handle AS raw_handle,
           dense_rank() OVER (ORDER BY count(*) DESC) AS rank
      FROM daily_board_runs r JOIN users u ON u.id = r.user_id
     GROUP BY r.user_id, u.handle
     ORDER BY n DESC`;
  return withHandle(rows.map((r) => ({
    rank: r.rank, userId: r.user_id, rawHandle: r.raw_handle, primary: Number(r.n), secondary: null,
  })));
}

/** BEST: a player's single highest pct, with the edition and season of that run. Ties: earliest. */
export async function bestLeaderboard(sql) {
  const rows = await sql`
    WITH ranked AS (
      SELECT r.user_id, r.pct, b.edition_date, b.season_year,
             row_number() OVER (PARTITION BY r.user_id ORDER BY r.pct DESC, b.edition_date ASC) AS rn
        FROM daily_board_runs r JOIN daily_boards b ON b.id = r.board_id
    )
    SELECT rk.user_id, rk.pct, to_char(rk.edition_date, 'YYYY-MM-DD') AS edition_date, rk.season_year,
           u.handle AS raw_handle,
           dense_rank() OVER (ORDER BY rk.pct DESC) AS rank
      FROM ranked rk JOIN users u ON u.id = rk.user_id
     WHERE rk.rn = 1
     ORDER BY rk.pct DESC, rk.edition_date ASC`;
  return withHandle(rows.map((r) => ({
    rank: r.rank, userId: r.user_id, rawHandle: r.raw_handle, primary: Number(r.pct), secondary: null,
    editionDate: r.edition_date, seasonYear: r.season_year,
  })));
}

export const LEADERBOARDS = {
  main: { label: 'Main', fn: mainLeaderboard },
  today: { label: 'Today', fn: todayLeaderboard },
  streak: { label: 'Streak', fn: streakLeaderboard },
  perfect: { label: 'Perfect boards', fn: perfectLeaderboard },
  played: { label: 'Boards played', fn: playedLeaderboard },
  best: { label: 'Best board', fn: bestLeaderboard },
};
