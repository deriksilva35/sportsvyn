// lib/results/daily.js - the Daily's results, in the one shape.
//
// IT REGRADES THE STORED RUN rather than reading a stored grade, because there
// is no stored grade: daily_board_runs keeps picks, score, pct and matched, and
// the per-slot pairing has always been rebuilt at read time
// (regradeStoredRun -> gradeFromOptimum). The lobby's own Daily row says so -
// "matched: regraded on the Results screen only".
//
// THE CEILING IS THE EDITION'S, FROZEN. daily_boards.ceiling and .best_roster
// were written when the board was created and are never recomputed - the
// standing ruling, because nfl_player_season_totals moves under a solve.

import { sql } from '../db.js';
import { regradeStoredRun } from '../daily/seasonBoardRuns.js';
import { todayLeaderboard } from '../daily/seasonBoardLeaderboards.js';
import { header, distribution, axisFor, lostIt, lastName, scoresOf } from './shape.js';

/** The Daily's slot rows in the mock's shape, from one side of a grade row. */
const slotRow = (p, { hit = false } = {}) => ({
  slot: p?.slot ?? null,
  pos: p?.position ?? p?.slot ?? null,
  name: p?.name ?? null,
  short: p?.name ? `${p.name.split(/\s+/)[0][0]}. ${lastName(p.name)}` : null,
  meta: p?.meta ?? null,
  team: p?.abbr ?? null,
  points: p?.points == null ? null : Math.round(Number(p.points) * 10) / 10,
  hit,
});

/**
 * @param boardId daily_boards.id
 * @param userId  whose results these are; null gives the field with no `mine`
 */
export async function dailyResults(boardId, userId = null) {
  const [board] = await sql`
    SELECT id, edition_date, season_year, board, ceiling, best_roster, slots, closes_at
      FROM daily_boards WHERE id = ${Number(boardId)}`;
  if (!board) return null;

  const [run] = userId == null ? [] : await sql`
    SELECT user_id, picks, score, pct, matched, elapsed_s, completed_at
      FROM daily_board_runs
     WHERE board_id = ${Number(boardId)} AND user_id = ${Number(userId)} AND picks IS NOT NULL`;

  const field = await todayLeaderboard(sql, Number(boardId));
  const scores = scoresOf(field, (r) => r.primary);
  const mineRank = userId == null ? null : (field.find((r) => r.userId === Number(userId)) ?? null);

  // A RUN THAT WAS STARTED AND NEVER SUBMITTED HAS NO PICKS and so no grade -
  // and the Daily has no DNF bucket for it, because todayLeaderboard only ever
  // returns submitted runs. An unsubmitted attempt is absent from the field,
  // which is what it is.
  const graded = run?.picks ? regradeStoredRun(board, run.picks, board.slots ?? null) : null;
  const rows = graded?.ok ? graded.grade.rows : [];

  const dist = distribution(scores, { mine: run?.score ?? null, ceiling: board.ceiling, dnf: 0 });
  const num = (n) => Number(n).toLocaleString('en-US');

  return {
    game: 'daily',
    title: 'The Daily',
    subtitle: `${board.season_year ?? ''}`.trim() || null,
    edition: `Edition ${String(board.id).padStart(3, '0')} · graded`,
    ceilingWord: 'perfect',
    header: header({
      rank: mineRank?.rank ?? null, of: field.length,
      score: run?.score ?? null, ceiling: board.ceiling,
      // daily_board_runs.pct IS A FRACTION, not a percentage - 1 for a perfect
      // board, 0.9566 for 95.7%. Every other reader of this column scales it
      // (lobbyV3's pctOfCeiling does); passing it through raw put "1%" in the
      // header of a perfect run.
      pct: run?.pct == null ? null : Number(run.pct) * 100,
    }),
    // THE TWO COLUMNS, PAIRED BY THE GRADER. `hit` is the grader's own verdict,
    // not a name comparison done again here.
    mine: rows.map((r) => slotRow(r.you, { hit: r.hit })),
    ceiling: rows.map((r) => slotRow(r.best, { hit: r.hit })),
    matched: graded?.ok ? graded.grade.matchedCount : null,
    slotCount: graded?.ok ? graded.grade.slotCount : null,
    // + 0 KILLS NEGATIVE ZERO, which the grader's own subtraction produces on a
    // perfect board and which prints as "-0".
    toCeiling: graded?.ok ? graded.grade.pointsLeft + 0 : null,
    // THE DAILY'S GRADER PAIRS BY SLOT INDEX, not by pairRows - its board is a
    // 64-card, name-unique grid, and its own rows already carry both sides. The
    // misses are shaped into the same sentence pairRows' are.
    lostIt: lostIt(rows.filter((r) => !r.hit && !r.ahead).map((r) => ({
      verdict: 'miss', label: r.you?.slot ?? null,
      diff: Math.round(((Number(r.you?.points) || 0) - (Number(r.best?.points) || 0)) * 10) / 10,
      you: r.you, best: r.best,
    }))),
    field: {
      distribution: dist,
      axis: axisFor(dist, { mine: run?.score ?? null, label: num }),
      median: dist.median,
      played: field.length,
      dnf: 0,
      rows: field.slice(0, 3).concat(
        mineRank && mineRank.rank > 3 ? [mineRank] : [],
      ).map((r) => ({
        // dense_rank() COMES BACK A STRING from the driver (bigint), and a
        // string rank compares wrong the moment anything sorts or tests it.
        rank: Number(r.rank), name: r.handle ?? r.rawHandle ?? `player ${r.userId}`,
        house: r.house === true, you: userId != null && r.userId === Number(userId),
        score: Math.round(Number(r.primary) * 10) / 10, userId: r.userId,
        pct: board.ceiling ? Math.round((Number(r.primary) / Number(board.ceiling)) * 1000) / 10 : null,
        sub: null,
      })),
    },
  };
}
