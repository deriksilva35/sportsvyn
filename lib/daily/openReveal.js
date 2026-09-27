// lib/daily/openReveal.js - what a finished Daily run may see while the day is open.
//
// ============================================================================
// THE ANSWER STAYS SECRET UNTIL MIDNIGHT; EVERYTHING ELSE IS YOURS NOW
// ============================================================================
// Ruling, 27 Sep (1b): the leak rule's PURPOSE survives, its old shape does not.
// Before close a finished run is shown:
//   - its own eight slots with their points, and the total
//   - its rank among runs that have finished, and "you beat X% of today's players"
//   - the streak
//   - today's board of finished runs: handle, score, rank - nothing else
// and is NOT shown, not even on the wire:
//   - the best roster, the ceiling, pct, matched, the per-slot hit glyph
//   - anybody else's picks
// At close the full grade (GradeScreen) and the perfect roster arrive, as before.
//
// WHY THIS IS SAFE (the 27 Sep read of v2): a finished run cannot change, so
// a board of finished scores tells its reader nothing they can still use; and
// a reader who has NOT finished never gets here - the page serves this only
// when the reader's own run has picks. The one thing a score could expose on a
// tiny board is another player's picks, by subset-sum over public card points,
// which is why the rows carry scores and never pct or matched.
//
// TIES ORDER BY FINISH TIME, NOT BY MATCHED. todayLeaderboard's order breaks a
// tied score on matched first, which is a fact about the hidden best roster;
// this board breaks it on who finished first, and the rank itself is dense on
// score alone.

import { todayLeaderboard, streakLeaderboard } from './seasonBoardLeaderboards.js';
import { regradeStoredRun } from './seasonBoardRuns.js';
import { boardView } from '../boards/live.js';

/**
 * THE CARDS STAY ON THE SERVER UNTIL THE CLOCK DOES (1b item 4, ruling 27 Sep).
 * Every card's points and stat line used to reach the client with the rules
 * card, signed out included - so the board could be solved before Start, off
 * the page payload. Before a run's start is recorded the page hands over the
 * twelve teams' keys only; POST /api/daily/board/start returns the cards once
 * the row exists (the clock is the game, and now it is the only way in).
 */
export function sealedTeams(teams = []) {
  return teams.map((t) => ({ key: t.key, abbr: t.abbr ?? null, record: t.record ?? null, card: [] }));
}

const r1 = (n) => Math.round(Number(n) * 10) / 10;

/** PURE. The run's own eight slots - never the grade's `best` side. */
export function ownRows(grade) {
  return (grade?.rows ?? []).map((r) => ({
    slot: r.you?.slot ?? null,
    name: r.you?.name ?? null,
    team: r.you?.abbr ?? null,
    points: r1(r.you?.points ?? 0),
  }));
}

/**
 * PURE. "You beat X% of today's players": the share of the OTHER finished runs
 * with a strictly lower score, rounded down so a tie is never counted as a
 * win. null when nobody else has finished - there is no field to beat yet.
 */
export function beatPct(scores, mine) {
  const others = scores.length - 1;
  if (others <= 0) return null;
  const below = scores.filter((s) => s < mine).length;
  return Math.floor((below / others) * 100);
}

/** PURE. The open board's rows from todayLeaderboard, re-ordered for ties by finish time. */
export function openBoardRows(field = []) {
  return [...field]
    .map((r) => ({
      userId: r.userId, name: r.handle ?? r.rawHandle ?? `player ${r.userId}`, points: r1(r.primary),
      rank: Number(r.rank), house: r.house === true || r.isHouse === true,
      finishedAt: r.completedAt ? new Date(r.completedAt).getTime() : null,
    }))
    .sort((a, b) => b.points - a.points || (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
    .map(({ finishedAt, ...r }) => r);
}

/**
 * The whole open-day reveal for one finished run: plain data, safe to hand a
 * client component. `board` is the daily_boards row, `run` the reader's
 * daily_board_runs row (picks NOT NULL).
 */
export async function openRevealFor(sql, { board, run, userId, editionDate }) {
  const graded = regradeStoredRun(board, run.picks);
  const rows = graded.ok ? ownRows(graded.grade) : [];
  const [field, streaks] = await Promise.all([
    todayLeaderboard(sql, board.id),
    streakLeaderboard(sql, editionDate),
  ]);
  const boardRows = openBoardRows(field);
  const view = boardView(boardRows, userId, { top: 10 });
  const mine = r1(run.score);
  return {
    rows,
    total: mine,
    rank: view.me?.rank ?? null,
    of: boardRows.length,
    beatPct: beatPct(boardRows.map((r) => r.points), mine),
    streak: streaks.find((s) => Number(s.userId) === Number(userId))?.primary ?? null,
    board: { head: view.head, around: view.around, gap: view.gap, me: view.me },
  };
}
