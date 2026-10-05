// lib/daily/shareCardData.js - one reader's share card for one edition, from
// the database. The model and every rule about what it may say are in
// lib/daily/shareCard.js; this file only gathers the facts.
//
// OWNERSHIP-SCOPED. A card is built from the READER's own run and nobody
// else's: there is no ?who=, and a reader with no submitted run on that
// edition gets null (the route turns that into a 404).
//
// THE PHASE IS THE DATABASE'S CLOCK, not the server's: now() >= closes_at,
// compared in Postgres like every other open/closed decision in this feature.

import { regradeStoredRun } from './seasonBoardRuns.js';
import { todayLeaderboard } from './seasonBoardLeaderboards.js';
import { beatPct } from './openReveal.js';
import { slotsOf } from './boardShape.js';
import { shareCardModel } from './shareCard.js';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * PURE. How many consecutive editions, ending exactly at `endYmd`, appear in
 * `dates` (any order, 'YYYY-MM-DD'). The card's streak is the streak AS OF
 * that edition - yesterday's card does not grow because you played today.
 */
export function consecutiveDays(dates, endYmd) {
  const have = new Set(dates);
  let n = 0;
  const d = new Date(`${endYmd}T12:00:00Z`);
  while (have.has(d.toISOString().slice(0, 10))) {
    n += 1;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return n;
}

export async function streakEndingAt(sql, userId, endYmd) {
  const rows = await sql`
    SELECT to_char(b.edition_date, 'YYYY-MM-DD') AS d
      FROM daily_board_runs r JOIN daily_boards b ON b.id = r.board_id
     WHERE r.user_id = ${userId} AND r.picks IS NOT NULL AND b.edition_date <= ${endYmd}::date
     ORDER BY b.edition_date DESC LIMIT 400`;
  return consecutiveDays(rows.map((r) => r.d), endYmd);
}

/**
 * @returns {Promise<object|null>} the card model, or null when there is no
 *   such edition or the reader has no submitted run on it.
 */
export async function shareCardFor(sql, { date, userId }) {
  if (!YMD.test(String(date ?? '')) || userId == null) return null;
  const [board] = await sql`
    SELECT *, to_char(edition_date, 'YYYY-MM-DD') AS edition_ymd, now() >= closes_at AS closed
      FROM daily_boards WHERE edition_date = ${date}::date`;
  if (!board) return null;
  const [run] = await sql`
    SELECT * FROM daily_board_runs
     WHERE board_id = ${board.id} AND user_id = ${userId} AND picks IS NOT NULL`;
  if (!run) return null;

  const [field, streak] = await Promise.all([
    todayLeaderboard(sql, board.id),
    streakEndingAt(sql, userId, board.edition_ymd),
  ]);
  const mine = Number(run.score);
  const me = field.find((r) => Number(r.userId) === Number(userId));
  const common = {
    editionDate: board.edition_ymd,
    seasonYear: board.season_year,
    streak,
    score: mine,
    played: field.length,
    rank: me?.rank ?? null,
    beatPct: beatPct(field.map((r) => r.primary), mine),
  };

  if (!board.closed) {
    return shareCardModel({ ...common, phase: 'open', slots: slotsOf(board) });
  }
  const regraded = regradeStoredRun(board, run.picks);
  if (!regraded.ok) return null;
  return shareCardModel({ ...common, phase: 'closed', grade: regraded.grade });
}
