// lib/util/scoresOf.js - the ONE place a list of numbers is read off rows.
// PURE: no database, no clock, no network.
//
// IT EXISTS BECAUSE Number(null) IS 0 AND 0 IS FINITE. The shape is always the
// same:
//
//     rows.map(Number).filter(Number.isFinite)
//
// which reads as "the numbers, honestly" and actually means "the numbers, plus a
// zero for every row that had none". NINE copies were in the tree when this
// module was written. Five wore that exact shape; the other four had the coercion
// and the filter split across two functions, or a loop starting at 0, and each
// half read as correct on its own. Three of the nine were live:
//
//   - the results grammar's field. Four entries, one a DNF with score NULL, and
//     the median came back 118.8 instead of 120.7. It would also have drawn a bar
//     at the bottom of every distribution for every reader who did not play.
//   - the Run's round lock, below.
//   - the gridiron odds consensus. One book with the outcome present and no price
//     became a decimal odd of 0 in the median; the de-vig then refused the number
//     and the whole market was dropped. It failed closed, which is why nobody saw
//     it - a missing line looks like a book that has not posted.
//
// AND IT IS NOT ONLY SCORES. new Date(null).getTime() is 0 too - the epoch - so
// the same shape applied to kickoff times makes a missing kickoff the EARLIEST
// one, which is how a round's first pitch could have been 1 Jan 1970.
//
// THE RULE: DECIDE ABSENCE BEFORE COERCING. null, undefined and '' are absent
// and leave the list; everything else is coerced and kept only if it is a finite
// number. A zero that was really a zero survives, because 0 is a real score.

/** null, undefined and '' are ABSENT. Everything else gets coerced. */
const absent = (v) => v == null || v === '';

/**
 * The finite numbers in a list of values, absences dropped.
 *
 * @param values  anything iterable of raw values
 */
export function numbersOf(values = []) {
  const out = [];
  for (const v of values ?? []) {
    if (absent(v)) continue;
    const n = Number(v);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * The scores of a list of ROWS, absences dropped.
 *
 * A DNF IS AN ABSENCE, NOT A ZERO, and that distinction is the whole point: a
 * caller that wants to show DNFs counts them separately (the results
 * distribution gives them their own bar) rather than letting them sit at the
 * bottom of the scale pretending to be bad scores.
 *
 * @param rows  entries, runs, anything with a score
 * @param pick  how to read the score off one row; defaults to `row.score`
 */
export function scoresOf(rows = [], pick = (r) => r?.score) {
  const out = [];
  for (const r of rows ?? []) {
    const raw = pick(r);
    if (absent(raw)) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** The instants in a list of date-ish values, absences dropped. */
export function instantsOf(values = []) {
  const out = [];
  for (const v of values ?? []) {
    if (absent(v)) continue;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    if (Number.isFinite(t)) out.push(t);
  }
  return out;
}

/** The mean of a list of raw values, absences dropped. One decimal. */
export function meanOf(values = []) {
  const nums = numbersOf(values);
  if (!nums.length) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 + 0;
}

/** The median of a list of raw values, absences dropped. One decimal. */
export function medianOf(values = []) {
  const nums = numbersOf(values).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  const m = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  return Math.round(m * 10) / 10 + 0;
}

/** The max of a list of raw values, absences dropped. */
export function maxOf(values = []) {
  const nums = numbersOf(values);
  return nums.length ? Math.max(...nums) : null;
}
