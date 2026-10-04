// lib/daily/seasonBoardHome.js — today's v2 board and this reader's run, for
// the lobby row (lib/games/dailyRow.js decides the words). ET edition date from
// Postgres, the same boundary the board page uses (todayEt).

import { sql } from '../db.js';
import { todayEt } from './entries.js';
import { isEditionLive, effectiveEpoch } from './seasonBoardEditions.js';

/**
 * @returns {{ editionDate: string, board: {id:number, closesAt:string}|null,
 *             run: {startedAt:string|null, completedAt:string|null, pct:number|null}|null,
 *             playingToday: number }}
 */
export async function dailyV2Home(uid = null, { db = sql, editionDate = null } = {}) {
  const date = editionDate ?? await todayEt();
  const [board] = await db`
    SELECT id, closes_at FROM daily_boards WHERE edition_date = ${date}::date LIMIT 1`;
  if (!board) return { editionDate: date, board: null, run: null, playingToday: 0 };
  const [{ n }] = await db`
    SELECT count(*)::int AS n FROM daily_board_runs WHERE board_id = ${board.id} AND completed_at IS NOT NULL`;
  let run = null;
  if (uid != null) {
    const [r] = await db`
      SELECT started_at, completed_at, pct FROM daily_board_runs
       WHERE board_id = ${board.id} AND user_id = ${uid} LIMIT 1`;
    if (r) run = { startedAt: r.started_at, completedAt: r.completed_at, pct: r.pct == null ? null : Number(r.pct) };
  }
  return { editionDate: date, board: { id: board.id, closesAt: board.closes_at }, run, playingToday: n };
}

/**
 * THE HOME PAGE'S DAILY CARD, FROM THE SEASON BOARD (sat-5 Y1). components/
 * today/GamesBand.js used to read v1 (getDailyHome / getYesterday, over the
 * v1 tables); with v1 retired and its cron unscheduled, no new v1 day
 * row is ever made and the card would have vanished from /. Same two props,
 * v2's facts:
 *   daily      { edition } when today's edition is live, else null (no card)
 *   yesterday  { perfect, winner: { score } | null } off the newest CLOSED
 *              edition - its frozen ceiling and its best submitted score -
 *              or null before any edition has closed.
 * Only closed editions are read for scores: an open board's field is not
 * public until midnight (lib/results/daily.js's close check).
 */
export async function dailyV2Band({ db = sql, editionLabel = null } = {}) {
  const home = await dailyV2Home(null, { db });
  // A LIVE EDITION WITH NO ROW YET STILL GETS ITS CARD: the row is made on
  // first read (ensureBoardForDate, /daily/board), so before anyone opens the
  // board today there is nothing in daily_boards - and the card is the door.
  const live = home.board != null || isEditionLive(home.editionDate, effectiveEpoch());
  const daily = live ? { edition: editionLabel ? editionLabel(home.editionDate) : null } : null;
  const [last] = await db`
    SELECT b.ceiling,
           (SELECT max(r.score) FROM daily_board_runs r
             WHERE r.board_id = b.id AND r.picks IS NOT NULL) AS top
      FROM daily_boards b
     WHERE now() >= b.closes_at
     ORDER BY b.edition_date DESC LIMIT 1`;
  const r1 = (x) => (x == null ? null : Math.round(Number(x) * 10) / 10);
  const yesterday = last && last.ceiling != null
    ? { perfect: r1(last.ceiling), winner: last.top != null ? { score: r1(last.top) } : null }
    : null;
  return { daily, yesterday };
}
