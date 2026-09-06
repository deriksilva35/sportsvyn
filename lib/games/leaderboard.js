// lib/games/leaderboard.js - the per-contest "board leaderboard" every grade
// screen shows (relay 2b items 2-4), as opposed to lib/games/read.js's
// pickemTable(), which ranks the whole SEASON. Same top/self split as that
// table (top N, plus the caller's own row when it falls outside the N), so
// one leaderboard component can render either.

import { sql } from '../db.js';
import { displayName } from '../daily/handles.js';

/** Top scorers for one settled Weekly or Draft contest. */
export async function scoreLeaderboard(contestId, uid = null, { limit = 5 } = {}) {
  const rows = await sql`
    SELECT e.user_id, e.score, u.handle
      FROM contest_entries e JOIN users u ON u.id = e.user_id
     WHERE e.contest_id = ${contestId} AND e.score IS NOT NULL
     ORDER BY e.score DESC, e.user_id ASC`;
  const ranked = rows.map((r, i) => ({
    rank: i + 1, userId: r.user_id, name: displayName({ id: r.user_id, handle: r.handle }),
    score: Number(r.score),
  }));
  const top = ranked.slice(0, limit);
  const mine = uid == null ? null : (ranked.find((r) => r.userId === uid) ?? null);
  return {
    top,
    self: mine && !top.some((r) => r.userId === mine.userId) ? mine : null,
    played: ranked.length,
  };
}

/**
 * The Pick'em board leaderboard - ONE BOARD's own correct count, unlike
 * lib/games/read.js's pickemTable() which ranks the whole season. Reads
 * contest_entries.score AS STAMPED AT SETTLE (lib/pickem/settle.js's own
 * scoreLineup()) rather than recomputing correct-count from lineup+results
 * here - a second independent count of the same board could only ever
 * agree by coincidence, or drift if either formula changed alone (the same
 * "frozen at settle" posture lib/weekly/view.js's settledView() already
 * applies to entry.meta.pct).
 */
export async function pickemBoardLeaderboard(contestId, uid = null, { limit = 5 } = {}) {
  const rows = await sql`
    SELECT e.user_id, e.score, u.handle
      FROM contest_entries e JOIN users u ON u.id = e.user_id
     WHERE e.contest_id = ${contestId} AND e.score IS NOT NULL
     ORDER BY e.score DESC, e.user_id ASC`;
  const ranked = rows.map((r, i) => ({
    rank: i + 1, userId: r.user_id, name: displayName({ id: r.user_id, handle: r.handle }),
    score: Number(r.score),
  }));
  const top = ranked.slice(0, limit);
  const mine = uid == null ? null : (ranked.find((r) => r.userId === uid) ?? null);
  return {
    top,
    self: mine && !top.some((r) => r.userId === mine.userId) ? mine : null,
    played: ranked.length,
  };
}

/**
 * The Draft's field leaderboard: scoreLeaderboard's own shape, plus the seat
 * each drafter sat in - "field leaderboard with seat beside every name"
 * (relay 2b item 3). LEFT JOIN, not JOIN: a bridge that never resolved a
 * draftId still owes its entry a row, just with no seat to show.
 */
export async function draftFieldLeaderboard(contestId, uid = null, { limit = 5 } = {}) {
  const rows = await sql`
    SELECT e.user_id, e.score, u.handle, d.pick_position AS seat
      FROM contest_entries e
      JOIN users u ON u.id = e.user_id
      LEFT JOIN drafts d ON d.id = (e.meta->>'draftId')::int
     WHERE e.contest_id = ${contestId} AND e.score IS NOT NULL
     ORDER BY e.score DESC, e.user_id ASC`;
  const ranked = rows.map((r, i) => ({
    rank: i + 1, userId: r.user_id, name: displayName({ id: r.user_id, handle: r.handle }),
    score: Number(r.score), seat: r.seat ?? null,
  }));
  const top = ranked.slice(0, limit);
  const mine = uid == null ? null : (ranked.find((r) => r.userId === uid) ?? null);
  return {
    top,
    self: mine && !top.some((r) => r.userId === mine.userId) ? mine : null,
    played: ranked.length,
  };
}

/**
 * BY SEAT, one week (relay 2b item 3): avg pts and drafter count per seat,
 * EVERY SEAT LISTED even at zero drafters ("undrafted seats say so") -
 * generate_series against DRAFT_CONFIG.teamsCount rather than deriving the
 * seat list from who happened to draft, which would silently drop a seat
 * nobody took.
 */
export async function draftSeatTable(contestId, teamsCount) {
  // JOIN, THEN GROUP IN JS - not a SQL generate_series/LEFT JOIN on
  // drafts.pick_position ALONE, which would match every draft ever played at
  // that seat across every week, not just this contest's. Correctness would
  // still hold (the contest_id filter lives in the same ON clause, so an
  // unrelated week's draft only ever contributes a null row a COUNT/AVG
  // already ignores) but at the cost of scanning the whole drafts table on
  // every settled render - this scopes the join to this contest's own
  // entries from the start.
  const rows = await sql`
    SELECT d.pick_position AS seat, e.score
      FROM contest_entries e
      JOIN drafts d ON d.id = (e.meta->>'draftId')::int
     WHERE e.contest_id = ${contestId} AND e.score IS NOT NULL`;

  const bySeat = new Map();
  for (const r of rows) {
    if (!bySeat.has(r.seat)) bySeat.set(r.seat, []);
    bySeat.get(r.seat).push(Number(r.score));
  }

  const table = [];
  for (let seat = 1; seat <= teamsCount; seat++) {
    const scores = bySeat.get(seat) ?? [];
    table.push({
      seat,
      avgPts: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
      drafters: scores.length,
    });
  }
  // Every seat is listed regardless of rank; undrafted seats (avgPts null)
  // sort last, by seat number among themselves.
  table.sort((a, b) => {
    if (a.avgPts == null && b.avgPts == null) return a.seat - b.seat;
    if (a.avgPts == null) return 1;
    if (b.avgPts == null) return -1;
    return b.avgPts - a.avgPts;
  });
  return table;
}
