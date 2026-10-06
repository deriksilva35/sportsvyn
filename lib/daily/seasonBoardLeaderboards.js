// lib/daily/seasonBoardLeaderboards.js — the six v2 leaderboards, all read
// A RUN COUNTS ONLY ONCE IT IS SUBMITTED. Since migration 097 a row is
// written at START with picks NULL, so every read in this file carries
// `r.picks IS NOT NULL`. A started-but-unsubmitted run is a consumed attempt,
// not a result: it must never rank, never count toward a streak, never appear
// in the played tally. Six reads, six filters - checked by
// seasonBoardStartRow.test.mjs, which greps this file rather than trusting it.
//
// models over daily_board_runs (standing ruling: only the Daily feeds a
// public board - preview and practice never write that table, so there is
// nothing here to exclude by game-mode; every row in daily_board_runs is
// already Daily-only by construction).
//
// EVERY QUERY SORTS SERVER-SIDE, WITH THE TIEBREAK IN THE ORDER BY - the
// header printed above a leaderboard is a promise about what order the rows
// are in, and a promise a JS .sort() could silently break is a promise this
// file keeps in SQL instead.
//
// THE TIE RULE (sun-16 C, lib/games/rank.js): rank is RANK() OVER (ORDER BY
// <primary> DESC) - tied values share the HIGHER place and the next place
// skips (1, 1, 3). It was DENSE_RANK (1, 1, 2). Within a tie the EARLIEST
// SUBMISSION is listed first, and nothing else breaks it - `matched`, which
// used to, is now a column on the row and not an order key. A board's
// submission is daily_board_runs.completed_at; an aggregate board's is the
// completed_at of the run that set its current value (the latest run it
// counts, or the best run itself) - whoever got there first.
//
// pct IS numeric (Postgres exact decimal), NEVER cast to float anywhere in
// this file - `pct >= 1` for the perfect-boards board is an EXACT compare
// with no epsilon, because there is nothing here that could introduce one.

import { displayName } from './handles.js';
import { houseMark } from '../house/mark.js';

// ONE MAPPER FOR THREE BOARDS, which is why the house mark rides here: main,
// today and streak all end in this function, so the flag reaches all three at
// once and cannot reach two of them.
function withHandle(rows) {
  return rows.map((r) => ({
    ...r,
    handle: displayName({ id: r.userId, handle: r.rawHandle }),
    ...houseMark({ isHouse: r.isHouse === true, handle: r.rawHandle }, 'daily'),
  }));
}

/**
 * MAIN: avg pct over a player's last 30 edition runs, minimum 10 runs.
 * Secondary = avg matched (shown, not an order key). Ties share the higher
 * place, earliest submission first: the latest counted run's completed_at,
 * the moment this average was posted.
 */
export async function mainLeaderboard(sql) {
  const rows = await sql`
    WITH ranked AS (
      SELECT r.user_id, r.pct, r.matched, b.edition_date, r.completed_at,
             row_number() OVER (PARTITION BY r.user_id ORDER BY b.edition_date DESC) AS rn
        FROM daily_board_runs r JOIN daily_boards b ON b.id = r.board_id
       WHERE r.picks IS NOT NULL
    ),
    last30 AS (SELECT * FROM ranked WHERE rn <= 30),
    agg AS (
      SELECT user_id, avg(pct) AS avg_pct, avg(matched) AS avg_matched,
             count(*) AS n, min(edition_date) AS earliest, max(completed_at) AS submitted_at
        FROM last30 GROUP BY user_id HAVING count(*) >= 10
    )
    SELECT a.user_id, a.avg_pct, a.avg_matched, a.n, to_char(a.earliest, 'YYYY-MM-DD') AS earliest,
           u.handle AS raw_handle, u.is_house,
           rank() OVER (ORDER BY a.avg_pct DESC) AS rank
      FROM agg a JOIN users u ON u.id = a.user_id
     ORDER BY a.avg_pct DESC, a.submitted_at ASC NULLS LAST, a.user_id ASC`;
  return withHandle(rows.map((r) => ({
    rank: Number(r.rank), userId: r.user_id, rawHandle: r.raw_handle, isHouse: r.is_house,
    primary: Number(r.avg_pct), secondary: Number(r.avg_matched), runsPlayed: Number(r.n), earliest: r.earliest,
  })));
}

/**
 * TODAY: raw score for ONE board. Secondary = matched (shown, not an order
 * key). Ties share the higher place; completed_at lists them, earliest first.
 */
export async function todayLeaderboard(sql, boardId) {
  const rows = await sql`
    SELECT r.user_id, r.score, r.matched, r.completed_at, u.handle AS raw_handle, u.is_house,
           rank() OVER (ORDER BY r.score DESC) AS rank
      FROM daily_board_runs r JOIN users u ON u.id = r.user_id
     WHERE r.board_id = ${boardId} AND r.picks IS NOT NULL AND NOT r.late_claim
     ORDER BY r.score DESC, r.completed_at ASC NULLS LAST, r.user_id ASC`;
  return withHandle(rows.map((r) => ({
    rank: Number(r.rank), userId: r.user_id, rawHandle: r.raw_handle, isHouse: r.is_house,
    primary: Number(r.score), secondary: r.matched, completedAt: r.completed_at,
  })));
}

/**
 * STREAK: current consecutive edition dates ending today or yesterday (ET -
 * the caller supplies todayEtDate, never computed here). Secondary =
 * longest ever (shown, not an order key); a tie is listed by the streak's
 * latest run, earliest first. Classic gaps-and-islands: edition_date minus its own
 * row_number (in date order) is constant within one consecutive run, so
 * grouping on that difference isolates every island in one pass.
 */
export async function streakLeaderboard(sql, todayEtDate) {
  const rows = await sql`
    WITH played AS (
      SELECT r.user_id, b.edition_date, max(r.completed_at) AS completed_at
        FROM daily_board_runs r JOIN daily_boards b ON b.id = r.board_id
       WHERE r.picks IS NOT NULL
       GROUP BY r.user_id, b.edition_date
    ),
    islands AS (
      SELECT user_id, edition_date, completed_at,
             edition_date - (row_number() OVER (PARTITION BY user_id ORDER BY edition_date))::int AS grp
        FROM played
    ),
    lengths AS (
      SELECT user_id, grp, count(*) AS len, max(edition_date) AS last_date, max(completed_at) AS last_at
        FROM islands GROUP BY user_id, grp
    ),
    per_user AS (
      SELECT user_id,
             max(len) AS longest,
             coalesce(max(len) FILTER (
               WHERE last_date = ${todayEtDate}::date OR last_date = ${todayEtDate}::date - 1
             ), 0) AS current,
             max(last_at) FILTER (
               WHERE last_date = ${todayEtDate}::date OR last_date = ${todayEtDate}::date - 1
             ) AS submitted_at
        FROM lengths GROUP BY user_id
    )
    SELECT p.user_id, p.current, p.longest, u.handle AS raw_handle, u.is_house,
           rank() OVER (ORDER BY p.current DESC) AS rank
      FROM per_user p JOIN users u ON u.id = p.user_id
     WHERE p.current > 0
     ORDER BY p.current DESC, p.submitted_at ASC NULLS LAST, p.user_id ASC`;
  return withHandle(rows.map((r) => ({
    rank: Number(r.rank), userId: r.user_id, rawHandle: r.raw_handle, isHouse: r.is_house,
    primary: Number(r.current), secondary: Number(r.longest),
  })));
}

/** PERFECT: count of runs with pct >= 1.0, exact numeric compare. */
export async function perfectLeaderboard(sql) {
  const rows = await sql`
    SELECT r.user_id, count(*) AS n, u.handle AS raw_handle,
           rank() OVER (ORDER BY count(*) DESC) AS rank
      FROM daily_board_runs r JOIN users u ON u.id = r.user_id
     WHERE r.pct >= 1 AND r.picks IS NOT NULL
     GROUP BY r.user_id, u.handle
     ORDER BY n DESC, max(r.completed_at) ASC NULLS LAST, r.user_id ASC`;
  return withHandle(rows.map((r) => ({
    rank: Number(r.rank), userId: r.user_id, rawHandle: r.raw_handle, primary: Number(r.n), secondary: null,
  })));
}

/** PLAYED: pure volume, no judgment - count of runs. */
export async function playedLeaderboard(sql) {
  const rows = await sql`
    SELECT r.user_id, count(*) AS n, u.handle AS raw_handle,
           rank() OVER (ORDER BY count(*) DESC) AS rank
      FROM daily_board_runs r JOIN users u ON u.id = r.user_id
     WHERE r.picks IS NOT NULL
     GROUP BY r.user_id, u.handle
     ORDER BY n DESC, max(r.completed_at) ASC NULLS LAST, r.user_id ASC`;
  return withHandle(rows.map((r) => ({
    rank: Number(r.rank), userId: r.user_id, rawHandle: r.raw_handle, primary: Number(r.n), secondary: null,
  })));
}

/** BEST: a player's single highest pct, with the edition and season of that run. Ties: that run's completed_at, earliest first. */
export async function bestLeaderboard(sql) {
  const rows = await sql`
    WITH ranked AS (
      SELECT r.user_id, r.pct, b.edition_date, b.season_year, r.completed_at,
             row_number() OVER (PARTITION BY r.user_id ORDER BY r.pct DESC, b.edition_date ASC) AS rn
        FROM daily_board_runs r JOIN daily_boards b ON b.id = r.board_id
       WHERE r.picks IS NOT NULL
    )
    SELECT rk.user_id, rk.pct, to_char(rk.edition_date, 'YYYY-MM-DD') AS edition_date, rk.season_year,
           u.handle AS raw_handle,
           rank() OVER (ORDER BY rk.pct DESC) AS rank
      FROM ranked rk JOIN users u ON u.id = rk.user_id
     WHERE rk.rn = 1
     ORDER BY rk.pct DESC, rk.completed_at ASC NULLS LAST, rk.user_id ASC`;
  return withHandle(rows.map((r) => ({
    rank: Number(r.rank), userId: r.user_id, rawHandle: r.raw_handle, primary: Number(r.pct), secondary: null,
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
