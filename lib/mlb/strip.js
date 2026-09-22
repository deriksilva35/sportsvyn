// lib/mlb/strip.js - the baseball card's situation line, and the diamond.
// PURE. No DB, no clock, no I/O.
//
// THIS IS THE DRIVE STRIP'S COUNTERPART AND NOT ITS REUSE. A football strip is
// a field with a ball on it; a baseball strip is a state - whose half it is,
// how many are out, what the count is, and who is on. They share a slot on the
// card and nothing else, which is why this is its own module rather than a
// mode of components/gridiron/Gamecast.js.
//
// THE DIAMOND IS ABSENT, NOT EMPTY, WHEN THE BASES ARE UNKNOWN. This is the
// single most important line in the file. balldontlie does not carry runners at
// all, so with MLB_STATSAPI off the bases are null on every game - and a
// diamond with three empty squares would then be a claim ("nobody on") made on
// every pitch of every game, on no evidence. null bases draw NO diamond.
// lib/mlb/statsapi.js basesOf() is what keeps those two apart.

import { shortOf, BASEBALL } from '../live/vocabulary.js';

/**
 * null AND '' ARE NOT ZERO, and this is the FOURTH place in the MLB build
 * where that has bitten: Number(null) is 0 and finite, so a bare Number()
 * guard turns "the provider did not say" into "nobody out" and "3-" into
 * "3-0". Both are statements about a live at-bat that nobody made.
 */
const finite = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "2 out" / "1 out" / "0 out". Null when the provider did not say. */
export function outsLabel(outs) {
  const n = finite(outs);
  if (n == null || n < 0 || n > 3) return null;
  // "1 out", not "1 outs". Everything else takes the plural, including 0.
  return `${n} out`;
}

/** "3-2". Null unless BOTH halves are known - "3-" is not a count. */
export function countLabel(balls, strikes) {
  const b = finite(balls); const s = finite(strikes);
  if (b == null || s == null) return null;
  if (b < 0 || b > 4 || s < 0 || s > 3) return null;
  return `${b}-${s}`;
}

/**
 * "runners 1st, 3rd" / "bases loaded" / "bases empty", or NULL when unknown.
 *
 * "BASES LOADED" IS THE ONE IDIOM WORTH SPELLING OUT because it is what a
 * reader calls it; every other combination is named by its bases. "bases
 * empty" is a real statement and is only reachable when the bases are KNOWN.
 */
export function basesLabel(bases) {
  if (!bases) return null;
  const on = [bases.first && '1st', bases.second && '2nd', bases.third && '3rd'].filter(Boolean);
  if (on.length === 3) return 'bases loaded';
  if (on.length === 0) return 'bases empty';
  return `runners ${on.join(', ')}`;
}

/**
 * THE SITUATION LINE. "Top 7th · 2 out · 3-2 · runners 1st, 3rd".
 *
 * EVERY PART IS DROPPED WHOLE WHEN IT IS NOT KNOWN, never rendered as a
 * placeholder - the same law the football strip follows about its down and
 * distance. A card with only "Top 7th" is telling the truth; a card reading
 * "Top 7th · — out · —-—" is telling the reader the product is broken.
 *
 * NOBODY IS BATTING BETWEEN HALVES. In Mid and End the outs and the count
 * belong to the half that just ended, so they are dropped: "Mid 7th" alone is
 * the state, and carrying "2 out" into it would describe a moment that is over.
 */
export function situationLine(liveState) {
  const half = shortOf(liveState, BASEBALL);
  if (!half) return null;
  const between = isBetween(liveState);
  const parts = [half];
  if (!between) {
    const o = outsLabel(liveState?.outs);
    const c = countLabel(liveState?.balls, liveState?.strikes);
    if (o) parts.push(o);
    if (c) parts.push(c);
    const b = basesLabel(liveState?.bases);
    if (b) parts.push(b);
  }
  return parts.join(' · ');
}

/**
 * THE THREE CELLS THE MOCK DRAWS (docs/design/mocks/mlb-scores-v0_1.html):
 * outs and the half on the left, the diamond in the middle, the count on the
 * right. This returns the two text cells; the diamond is `bases` below.
 *
 *   lead   "2 out"      sub "Top 7th"        count "3-2"
 *   lead   "Mid 4th"    sub "changing sides" count null
 *   lead   "Top 7th"    sub null             count "3-2"   (outs not known)
 *
 * THE LEAD IS NEVER A PLACEHOLDER. When the outs are unknown the half moves
 * INTO the lead rather than leaving "— out" standing over it, because the
 * mock's left cell is the loudest text on the strip and it must always be
 * something true. That is the same law the football strip follows about its
 * down and distance, applied to a cell that cannot be empty.
 *
 * NOBODY IS BATTING BETWEEN HALVES. In Mid and End the outs and the count
 * belong to the half that just ended, so the mock drops both and the diamond
 * with them: "Mid 4th · changing sides" IS the state.
 */
export function stripCells(liveState) {
  const half = shortOf(liveState, BASEBALL);
  if (!half) return null;
  if (isBetween(liveState)) return { lead: half, sub: 'changing sides', count: null };
  const outs = outsLabel(liveState?.outs);
  const count = countLabel(liveState?.balls, liveState?.strikes);
  return outs
    ? { lead: outs, sub: half, count }
    : { lead: half, sub: null, count };
}

const isBetween = (ls) => ls?.half === 'Mid' || ls?.half === 'End';

/**
 * THE WHOLE STRIP as a view model. Returns null when there is nothing to draw,
 * so the card can omit the slot rather than render an empty one.
 */
export function baseballStrip({ status, liveState = null, scoringPlays = [] } = {}) {
  if (status !== 'live') return null;
  const cells = stripCells(liveState);
  if (!cells) return null;
  const between = isBetween(liveState);
  return {
    ...cells,
    // THE DIAMOND GOES WITH THE COUNT between halves - the mock drops both,
    // and a diamond left standing there would show the runners who were on
    // when the third out was recorded, which is a picture of a moment that
    // has ended.
    bases: between ? null : (liveState?.bases ?? null),
    between,
    // THE SENTENCE, kept whole for the Live Activity and for any surface too
    // narrow to draw three cells.
    line: situationLine(liveState),
    lastPlay: newestScoringPlay(scoringPlays)?.text ?? null,
  };
}

/**
 * THE NEWEST SCORING PLAY. scoring_summary is oldest-first, so the newest is
 * the last - stated rather than assumed, because a reversed feed would put the
 * first run of the game under a card in the ninth and look plausible.
 */
export function newestScoringPlay(plays = []) {
  const list = Array.isArray(plays) ? plays.filter((p) => p?.text) : [];
  return list.length ? list[list.length - 1] : null;
}
