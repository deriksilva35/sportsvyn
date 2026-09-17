// lib/daily/format.js - how a Daily score is written as a share of the board's
// ceiling. PURE, and the ONLY place that arithmetic happens for display.
//
// WHY A FORMATTER AND NOT A NUMBER. Three surfaces showed this percentage -
// the results header, the share card and the lobby's Yesterday line - and each
// printed `${grade.pct}%` off one whole-number rounding. Whole numbers cost the
// distinction the board is actually about: 2363.1 of 2371.1 is 99.66%, which
// rounded to "100%" and read as a perfect board that was eight points short.
//
// THE RULES, each of which exists because of a way the old line could lie:
//   - A ZERO CEILING IS "0.0%", NOT A DIVISION. The full relay states this
//     outright, and the earlier truncated send of the same relay said null and
//     omit; this follows the complete one. There is no division on that path -
//     the branch returns before it.
//   - A CEILING WE DO NOT HAVE AT ALL (null, missing, non-finite) still
//     returns null, and the caller OMITS the percentage. That is not the same
//     claim as a zero ceiling: one is "this board allowed nothing", the other
//     is "we do not know what this board allowed".
//   - "100%" IS EARNED, NOT ROUNDED TO. It is returned only when the score
//     actually reaches the ceiling. A board that is not the ceiling never
//     reads 100 in any form, which is why a one-decimal rounding that lands on
//     100.0 is held at "99.9%" instead.
//   - ONE DECIMAL OTHERWISE, ordinary rounding: 99.66 -> "99.7%".

/**
 * @param {number|string|null|undefined} score
 * @param {number|string|null|undefined} ceiling
 * @returns {string|null} "100%", "99.7%", "90.2%", "0.0%" - or null when the
 *   ceiling is unknown or the score is missing, in which case the caller shows
 *   nothing at all.
 */
export function pctOfCeiling(score, ceiling) {
  const c = Number(ceiling);
  if (ceiling == null || !Number.isFinite(c)) return null;
  // ZERO FIRST, AND NO DIVISION ANYWHERE NEAR IT.
  if (c <= 0) return '0.0%';
  const s = Number(score);
  // A MISSING SCORE IS NOT A ZERO SCORE. A run with no score (a DNF, an
  // unfinished row) has no share of anything, and "0.0%" would read as a
  // played board that scored nothing.
  if (score == null || !Number.isFinite(s)) return null;

  if (s >= c) return '100%';

  const oneDp = Math.round((s / c) * 1000) / 10;
  // THE CAP. 2370.9 of 2371.1 is 99.9916%, which rounds to 100.0 at one
  // decimal - and that is the one number this formatter must never print for
  // a board that fell short. Held at the highest value that is still true.
  if (oneDp >= 100) return '99.9%';
  return `${oneDp.toFixed(1)}%`;
}
