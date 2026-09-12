// lib/daily/seasonBoardHome.js — today's v2 board and this reader's run, for
// the lobby row (lib/games/dailyRow.js decides the words). ET edition date from
// Postgres, the same boundary the board page uses (todayEt).

import { sql } from '../db.js';
import { todayEt } from './entries.js';

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
