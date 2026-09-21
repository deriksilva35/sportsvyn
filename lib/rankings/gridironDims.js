// lib/rankings/gridironDims.js - Elo -> two of the five rubric dimensions.
// PURE: no DB, no clock, no I/O.
//
// THE RUBRIC HAS FIVE DIMENSIONS AND THIS FILE FILLS TWO. lib/rankings/
// teamPowerScorer.js scores result, process, squad, coherence and momentum by
// asking a model to read a team; a gridiron board computed from finished games
// can honestly answer two of them and nothing more:
//
//   result    what the team's record actually is, which is what Elo measures
//   momentum  which way it has been moving, which is elo_delta3
//
// process, squad and coherence are HELD, not zeroed. computeEditorialComposite
// (teamPowerScorer.js:324) averages over the dims actually scored, so a held
// dimension costs a team nothing - and the board says "2 of 5 dimensions" to
// the reader rather than implying five were considered. Zeroing them would
// have divided every composite by five and made the whole board look weak
// against a World Cup edition that really does score all five.
//
// WHY A Z-SCORE AND NOT THE RAW ELO. The dimensions are a 0-10 scale shared
// with an editorial rubric a human fills in by hand; an Elo is an unbounded
// number around 1500 whose useful spread differs by league and by week. The
// only honest way to put one on the other's scale is to say where the team
// sits IN ITS OWN FIELD. So each dimension is the team's z-score within the
// league field being published, recentred on 5:
//
//   dim = clamp(5 + SPREAD * z, 0, 10), to one decimal
//
// SPREAD = 2 means a team two and a half standard deviations clear of its
// field reaches 10.0 and one that far below reaches 0.0. That is deliberate:
// in a 32-team NFL field the best side is typically ~1.8σ up, so the top of
// the board lands around 8.5-9 and 10.0 stays reserved for a genuinely
// historic season rather than being spent every year on whoever is first.
//
// A FIELD WITH NO SPREAD SCORES 5.0, NOT NaN. One team, or a field where every
// value is identical, has a standard deviation of zero and no team is above or
// below anybody. Dividing by it would produce NaN or Infinity and put a
// literal "NaN" on a board; the answer is that nobody is distinguished, which
// is the midpoint. This is the single most likely shape on the first run of a
// new league, so it is a rule and not an edge case.

/** Points of dimension per standard deviation. See the header. */
export const SPREAD = 2;

/** The five rubric dimensions, in rubric order. Two are scored here. */
export const DIMS = Object.freeze(['result', 'process', 'squad', 'coherence', 'momentum']);
export const SCORED_DIMS = Object.freeze(['result', 'momentum']);
export const HELD_DIMS = Object.freeze(['process', 'squad', 'coherence']);

const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Mean and POPULATION standard deviation of the finite values in a field. */
export function fieldStats(values = []) {
  // null AND '' ARE NOT ZERO. Number(null) is 0 and finite, so a bare
  // .map(Number) would have pulled every absent value into the field as a
  // rating of zero and dragged the mean through the floor. Same guard as
  // lib/ratings/elo.js uses on a score, for the same reason.
  const xs = (values ?? [])
    .filter((v) => v != null && v !== '')
    .map(Number)
    .filter((v) => Number.isFinite(v));
  if (!xs.length) return { n: 0, mean: null, sd: null };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  // POPULATION, not sample: the field IS the population - these are the 32
  // teams in the league, not a sample drawn from a larger one - and a sample
  // sd would divide by zero on a field of one rather than returning 0.
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { n: xs.length, mean, sd: Math.sqrt(variance) };
}

/**
 * One value's place in its field, on the 0-10 dimension scale, to 1dp.
 * Returns null when the value itself is absent - an unmeasured dimension is
 * held, never scored 5.0 by default.
 */
export function zScale(value, field, { spread = SPREAD } = {}) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return null;
  const { n, mean, sd } = fieldStats(field);
  if (!n) return null;
  // NO SPREAD MEANS NOBODY IS DISTINGUISHED. z is 0 and the answer is the
  // midpoint, which is also the one-team-field case.
  const z = sd > 0 ? (Number(value) - mean) / sd : 0;
  return round1(clamp(5 + spread * z, 0, 10));
}

/**
 * The dimensions for one team, in the shape computeEditorialComposite and
 * composeOuterScores already consume.
 *
 * @param elo          this team's rating
 * @param delta3       its signed rating change over its last three games, or null
 * @param eloField     every rated team's elo in the field being published
 * @param delta3Field  every rated team's delta3 in that field
 * @returns { dims, scored_dims, held_dims } - scored_dims names only the
 *   dimensions that actually produced a number, so a team with no momentum
 *   signal composes over result alone rather than over a fabricated 5.0.
 */
export function gridironDims({ elo = null, delta3 = null, eloField = [], delta3Field = [] } = {}) {
  const result = zScale(elo, eloField);
  const momentum = zScale(delta3, delta3Field);
  const dims = { result, process: null, squad: null, coherence: null, momentum };
  const scored = SCORED_DIMS.filter((d) => dims[d] != null);
  return {
    dims,
    scored_dims: scored,
    held_dims: DIMS.filter((d) => !scored.includes(d)),
  };
}
