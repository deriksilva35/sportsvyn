// lib/boards/view.js - the live boards' pure half: rank, movement, the view.
//
// No database import, on purpose: a page and a render test can shape a board
// without loading a driver. lib/boards/live.js re-exports all three.

const round1 = (x) => Math.round(Number(x) * 10) / 10;

/**
 * PURE. Competition-ranked rows from { userId, points, ... }: sorted by points
 * descending (user id breaks the ORDER of a tie, never its rank).
 */
export function rankRows(rows = []) {
  const sorted = [...rows].sort((a, b) => b.points - a.points || a.userId - b.userId);
  let rank = 0; let prev = null;
  return sorted.map((r, i) => {
    if (prev === null || r.points !== prev) { rank = i + 1; prev = r.points; }
    return { ...r, rank };
  });
}

/**
 * PURE. Attach movement to ranked rows from each entry's standing THEN (a Map
 * userId -> { points, rank }). An entry with no standing then (joined the
 * board inside the window, or the snapshots have not reached back that far)
 * has no movement - null, drawn as a dash - never a fabricated zero.
 *   dPoints  points gained since then (+)
 *   dRank    places climbed since then (+ = up)
 */
export function withMovement(rows = [], then = new Map()) {
  return rows.map((r) => {
    const t = then.get(r.userId);
    if (!t) return { ...r, dPoints: null, dRank: null };
    return { ...r, dPoints: round1(r.points - Number(t.points)), dRank: Number(t.rank) - r.rank };
  });
}

/**
 * PURE. What the page draws: the top of the table, the reader's own row with
 * a neighbour either side (when it is not already in the top), the pinned
 * "you" card, and the top-10% line.
 */
export function boardView(rows = [], uid = null, { top = 10 } = {}) {
  const head = rows.slice(0, top);
  const i = uid == null ? -1 : rows.findIndex((r) => String(r.userId) === String(uid));
  const me = i < 0 ? null : rows[i];
  const around = i < 0 || i < top ? [] : rows.slice(Math.max(top, i - 1), i + 2);
  // THE TOP-10% LINE NEEDS A FIELD: under ten entries it is just first place.
  const cutRow = rows.length >= 10 ? rows[Math.ceil(rows.length * 0.1) - 1] : null;
  return {
    head, around, me, count: rows.length,
    gap: around.length > 0 && around[0] !== rows[top],
    topTenCut: cutRow ? cutRow.points : null,
  };
}

