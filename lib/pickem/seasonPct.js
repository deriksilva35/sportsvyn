// lib/pickem/seasonPct.js - one reader's season line for the board header.
// PURE: pickemTable()'s own output in, a small object or null out.
//
// WHY A HELPER AND NOT A QUERY. lib/games/read.js's pickemTable() already
// computes every player's season correct/played across settled boards, and the
// lobby already calls it. The board header needs ONE row out of that table -
// the reader's own - and computing it a second way is how two surfaces come to
// disagree about the same person's record.
//
// WHERE THE ROW HIDES. pickemTable returns { top, self }: `self` is populated
// ONLY when the reader falls outside the top N. A reader who is in the top N
// is in `top` and `self` is null. Reading `self` alone - the obvious mistake -
// shows a season line to everyone except the people doing best.
//
// THE FORMAT IS THE MOCK'S: a three-decimal average, ".667", not a percentage.
// It is derived from correct/played rather than from pickemTable's own `pct`
// (which is a rounded percentage, 66.7) so the rounding happens once.

/**
 * @param table pickemTable()'s return, or null
 * @param userId the reader's id, or null when signed out
 * @returns { correct, played, avg } | null - null when there is nothing
 *          honest to show: no settled boards, no id, or no resolved game.
 */
export function mySeason(table, userId) {
  if (!table || userId == null) return null;
  const rows = [...(table.top ?? []), ...(table.self ? [table.self] : [])];
  const mine = rows.find((r) => Number(r.userId) === Number(userId)) ?? null;
  if (!mine || !mine.played) return null;
  return { correct: mine.correct, played: mine.played, avg: avgOf(mine.correct, mine.played) };
}

/** correct/played -> ".667". A perfect record is "1.000", and zero is ".000" -
 * the leading zero is dropped exactly where a batting average drops it. */
export function avgOf(correct, played) {
  if (!played) return null;
  const v = correct / played;
  if (v >= 1) return '1.000';
  return `.${String(Math.round(v * 1000)).padStart(3, '0')}`;
}
