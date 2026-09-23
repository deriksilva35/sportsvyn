// lib/results/shape.js - the parts of a results screen that are the same in all
// four games. PURE: no database, no clock, no network.
//
// ONE GRAMMAR, FOUR GAMES (docs/design/mocks/results-grammar-v0_1.html): a
// header of three numbers over a bar, You vs the ceiling, The field. What
// differs between the games is what a ceiling IS and what a slot IS - and both
// of those are the READER's business, not this file's. Everything here takes
// numbers and gives numbers.
//
// THE CEILING IS NEVER RECOMPUTED HERE. Every game stores its own at settle
// (daily_boards.ceiling, contests.perfect) for the reason the Daily's own
// ruling states: a fresh solve can drift when the season totals move under it.
// This module is handed the stored number.

import { numbersOf, scoresOf, medianOf } from '../util/scoresOf.js';

/** The house rounding: one decimal, and an integer stays an integer. */
// +0 AT THE END KILLS NEGATIVE ZERO. Math.round(-0.04 * 10) / 10 is -0, which
// prints as "-0" and reads as a defect on a screen whose whole job is numbers.
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10 + 0;

/** "41st" - and the teens are the case a naive rule gets wrong. */
export function ordinal(n) {
  const i = Number(n);
  if (!Number.isFinite(i) || i < 1) return null;
  const teen = i % 100;
  if (teen >= 11 && teen <= 13) return `${i}th`;
  return `${i}${({ 1: 'st', 2: 'nd', 3: 'rd' })[i % 10] ?? 'th'}`;
}

/**
 * THE HEADER'S THREE NUMBERS. Rank of the field, percent of the ceiling, and
 * the score - plus the room rank the Draft carries as a fourth, because in that
 * game both ranks are true and the mock prints both.
 *
 * A CEILING OF ZERO LEAVES pctOfCeiling NULL rather than dividing by it, and a
 * missing rank leaves `topPct` absent rather than claiming "top 0%".
 *
 * AND A MISSING SCORE IS NULL, NOT ZERO. This function used to open with
 *
 *     const s = Number(score);
 *
 * which is the repo's oldest trap wearing its tenth disguise: Number(null) is 0,
 * 0 is finite, so a reader with NO ENTRY got score 0 and - because 0/187.3 is a
 * real division - pctOfCeiling 0. That is what put "0 points" and a bar painted
 * to 0% on the served header of every contest somebody had not played. The four
 * readers were passing null correctly the whole time; this line turned it into a
 * last-place finish. Absence is decided BEFORE the coercion now, the same rule as
 * lib/util/scoresOf.js, which is where the helper comes from.
 */
export function header({
  rank = null, of = null, score = null, ceiling = null,
  roomRank = null, roomOf = null, roomName = null, pct = null,
} = {}) {
  // ONE VALUE THROUGH THE ONE READER: null/undefined/'' leave as null, a real 0
  // survives as 0, because a reader who scored nothing DID score nothing.
  const one = (v) => { const [n] = numbersOf([v]); return n == null ? null : n; };
  const c = one(ceiling);
  const s = one(score);
  const pctOfCeiling = pct != null ? r1(pct)
    : (c != null && c > 0 && s != null ? r1((s / c) * 100) : null);
  return {
    rank: rank == null ? null : Number(rank),
    rankLabel: ordinal(rank),
    of: of == null ? null : Number(of),
    // "top 3.4%" - the reader's own position as a share of the field, rounded
    // the way a share should be and absent when there is no field to be top of.
    topPct: rank != null && of ? r1((Number(rank) / Number(of)) * 100) : null,
    score: s == null ? null : r1(s),
    ceiling: c == null ? null : r1(c),
    pctOfCeiling,
    roomRank: roomRank == null ? null : Number(roomRank),
    roomRankLabel: ordinal(roomRank),
    roomOf: roomOf == null ? null : Number(roomOf),
    roomName: roomName ?? null,
  };
}

// THE SCORE LIST IS READ IN ONE PLACE, lib/util/scoresOf.js, and re-exported
// here so the four readers keep importing their whole vocabulary from one module.
// A DNF IS AN ABSENCE, NOT A ZERO - see that file's header for the nine copies
// of the trap and the three that were live.
// IMPORTED AND RE-EXPORTED, not `export ... from`. A re-export forwards the name
// to importers and binds NOTHING in this module's scope: distribution() calls
// medianOf() forty lines down and threw "medianOf is not defined" on every real
// contest. It threw only against a DEV board, which is why the full suite is the
// gate and a mount test is not.
export { scoresOf, numbersOf, medianOf };

/**
 * THE LINE A READER WITH NO ENTRY GETS, in place of a rank and a score.
 *
 * NOT ZEROS, AND NOT A BLANK RANK. Before this, a reader who had not played got
 * the header's own shape with nothing in it: rank "-", "0" points, a bar painted
 * to 0% of the ceiling. Every one of those is a claim - that they came last, that
 * they scored nothing, that they got none of the way to the optimal lineup - and
 * all three are false about somebody who was not there. "Did not play" and
 * "played and scored zero" are different facts and the screen has to be able to
 * say which.
 *
 * THE PERIOD IS THE GAME'S OWN. "this week" is true of the Weekly and Pick'em and
 * a lie on a Daily board, which is one day, or on a draft, which is one room.
 *
 * ONE STRING, ONE PLACE. The four readers call this; the component prints what it
 * is handed and invents no copy of its own.
 */
export function noEntryLine(period = 'week') {
  return `You didn't play this ${period}`;
}

export const BUCKETS = 12;

/**
 * THE FIELD'S SHAPE. Twelve buckets over the scored range, plus a DNF bucket on
 * the LEFT where a game has DNFs at all - and only where it does, because a
 * bucket labelled DNF with nothing in it tells a reader the game has a failure
 * mode nobody hit, which is noise on a results screen.
 *
 * THE RANGE ENDS AT THE CEILING, not at the best score, so the distance between
 * the field and the ceiling is visible - that gap is the whole point of the
 * module. It starts at the lowest scored entry.
 *
 * THE MEDIAN IS OVER SCORED ENTRIES ONLY. A DNF is not a low score, it is an
 * absent one, and letting fourteen of them drag a median down would describe a
 * field nobody played in.
 *
 * `me` marks the bucket the reader is in; `top` marks every bucket ABOVE it,
 * which is what the mock dims in dark volt - the part of the field that beat
 * them.
 *
 * @param scores  every SCORED entry's score
 * @param opts    { mine, ceiling, dnf } - dnf is a COUNT, not a list
 */
export function distribution(scores = [], { mine = null, ceiling = null, dnf = 0 } = {}) {
  // THROUGH THE ONE READER, so a null in the caller's list cannot become a 0
  // here either - belt and braces, and the braces are the cheap half.
  const vals = numbersOf(scores).sort((a, b) => a - b);
  const dnfCount = Number(dnf) || 0;
  if (!vals.length) {
    return {
      bars: dnfCount ? [{ key: 'dnf', dnf: true, n: dnfCount, pct: 100, me: false, top: false }] : [],
      median: null, low: null, high: null, played: 0, dnf: dnfCount, myBucket: null,
    };
  }
  const low = vals[0];
  const c = Number(ceiling);
  const high = Number.isFinite(c) && c > vals[vals.length - 1] ? c : vals[vals.length - 1];
  // A FIELD WHERE EVERYBODY SCORED THE SAME is one bucket wide, and dividing by
  // a zero span would put every entry in bucket NaN.
  const span = high - low;
  const width = span > 0 ? span / BUCKETS : 0;
  const bucketOf = (v) => {
    if (width === 0) return 0;
    const i = Math.floor((v - low) / width);
    return i >= BUCKETS ? BUCKETS - 1 : i < 0 ? 0 : i;
  };

  const counts = new Array(BUCKETS).fill(0);
  for (const v of vals) counts[bucketOf(v)] += 1;
  const myBucket = mine == null || !Number.isFinite(Number(mine)) ? null : bucketOf(Number(mine));
  const tallest = Math.max(dnfCount, ...counts) || 1;

  const bars = [];
  if (dnfCount) {
    bars.push({ key: 'dnf', dnf: true, n: dnfCount, pct: Math.round((dnfCount / tallest) * 100), me: false, top: false });
  }
  for (let i = 0; i < BUCKETS; i += 1) {
    bars.push({
      key: `b${i}`, dnf: false, n: counts[i],
      pct: Math.round((counts[i] / tallest) * 100),
      me: myBucket === i,
      top: myBucket != null && i > myBucket,
      from: r1(low + i * width), to: r1(low + (i + 1) * width),
    });
  }

  return {
    bars, median: medianOf(vals), low: r1(low), high: r1(high),
    played: vals.length, dnf: dnfCount, myBucket,
  };
}

/**
 * THE AXIS THE MOCK DRAWS: five labels, the fourth of which is the reader and
 * the fifth the ceiling. The two in the middle are the quarter points of the
 * range, which is what makes the bars readable without a gridline.
 *
 * DNF LEADS IT when a game has any, because the leftmost bar is then the DNFs
 * and an axis that started at a score would be labelling the wrong bar.
 */
export function axisFor(dist, { mine = null, label = (n) => String(n) } = {}) {
  if (!dist || dist.low == null) return [];
  const { low, high } = dist;
  const q = (f) => label(r1(low + (high - low) * f));
  const out = dist.dnf ? ['DNF'] : [label(low)];
  out.push(q(1 / 3), q(2 / 3));
  // NO READER, NO "you" LABEL - AND NO DUPLICATE. The fourth slot is the reader's
  // own mark; with nobody there it used to fall back to the high value, which the
  // fifth slot already carries, so a no-entry axis ended with the ceiling printed
  // twice. Four labels is the honest answer: the scale, and where it stops.
  if (mine != null) out.push(`you · ${label(r1(mine))}`);
  out.push(label(high));
  return out;
}

/**
 * WHERE YOU LOST IT: pairRows' MISSES, biggest gap first, top three.
 *
 * IT IS NOT "your worst slots". A miss row is a PAIR - the player you had
 * against the player you did not - and its diff is what that swap cost. Sorting
 * on the diff rather than on your own points is the difference between "Kelce
 * scored 130" (true and useless) and "Gibbs over Henry, −133" (the decision).
 *
 * AHEAD ROWS ARE EXCLUDED. pairRows marks a leftover where you outscored the
 * ceiling's leftover as 'ahead', and a line called "where you lost it" that
 * listed a slot you WON is a line nobody can act on.
 *
 * @param rows  pairRows()'s output
 */
export function lostIt(rows = [], { limit = 3 } = {}) {
  return (rows ?? [])
    .filter((r) => r?.verdict === 'miss' && Number.isFinite(Number(r.diff)))
    .sort((a, b) => Number(a.diff) - Number(b.diff))
    .slice(0, limit)
    .map((r) => ({
      slot: r.label ?? null,
      delta: r1(r.diff),
      you: r.you?.name ?? null,
      best: r.best?.name ?? null,
      // "Gibbs over Henry" when both sides have a name; just the name when the
      // ceiling's leftover ran out, which happens on a short field.
      phrase: r.you?.name && r.best?.name
        ? `${lastName(r.you.name)} over ${lastName(r.best.name)}`
        : (r.you?.name ? lastName(r.you.name) : null),
    }));
}

/** "J. Gibbs" and "Jahmyr Gibbs" both become "Gibbs". */
export function lastName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}
