// lib/fantasy/grade.js — PURE draft grade formula. Documented for transcription
// to /methodology (docs/design/sim-methodology-draft.md). No I/O, no AI, no DB.
//
// Grade = value (what you paid vs the market) + construction (what you built).
//
// STATED PRINCIPLE (weights) — verbatim for /methodology:
//   "The draft is mostly what you paid vs the market, partly what you built."
// STATED PRINCIPLE (calibration) — verbatim for /methodology:
//   "An unattended draft is an average draft." The bands are calibrated so the
//   median full-auto draft lands B-/C+ and A is at most 5% of auto-drafts;
//   calibration moves the band EDGES, never the formula.

import { byeStackWarnings } from './engine.js';

const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);
// Non-K/DST starter slots — the ones a real draft should secure early; K/DST are
// expected in rounds 13-15 and are excluded from the "no end-game scramble" check.
const STARTER_SKILL_SLOTS = new Set(['QB', 'RB', 'WR', 'TE', 'FLEX']);

export const VALUE_WEIGHT = 0.6;
export const CONSTRUCTION_WEIGHT = 0.4;
const VALUE_K = 120;          // maps normalized per-pick value onto the 0-100 subscore
const STARTER_MIN_ROUND = 11; // skill starters filled after this round each deduct

// Band edges — CALIBRATED on 300 seeded full-auto drafts (see methodology entry).
//
// RECALIBRATED 2026-08-02. The monitor breached the A ceiling three days running
// (7.3 / 6.0 / 8.3%) and the median tipped into B, so the grader had drifted
// generous against "an unattended draft is an average draft".
//
// THE CENTRE AND THE TAIL MOVED BY DIFFERENT AMOUNTS, which is what decides the
// shape of this fix. Measured against the original corpus, the pool now sits
// about +3 higher through the middle (median 67.2 -> 69.9, p25 57.7 -> 60.8) -
// FFC's board consolidating through the summer, so auto-picks land nearer market
// and value subscores rise together. But at a FIXED edge of 88 the A-rate went
// 4.7% -> 8.3%, far more than a +3 level shift explains. The upper tail fattened
// on top of the level shift, so a uniform shift cannot satisfy both stated claims
// at once: enough shift to fix the tail drags the median down its band, and
// enough to centre the median leaves the tail over the ceiling.
//
// So the two claims are calibrated where each one lives, which is the honest
// reading of the evidence rather than a compromise between them:
//
//   B 70 -> 73 and B- 63 -> 66  (+3, tracking the CENTRE)
//     The median is the "average draft" claim. It moved +2.7, so these move +3
//     with it. That puts today's median (69.9) at 3.9 into the 7-point B- band
//     instead of 0.1 BELOW the old B edge - which is precisely why one ordinary
//     day (08-02, median 70.4) tipped the median into B and fired the alert.
//
//   A 88 -> 93  (+5, tracking the TAIL)
//     The ceiling is a claim about the tail, and the tail moved more. 88 also sat
//     on a dense cluster - about 5 drafts per point around 88-89 - so small board
//     drift pushed several across at once, which is how 4.7% became 8.3%. The
//     93+ region holds roughly 1 draft per point, so the line sits somewhere
//     stable instead of on a cliff edge.
//
//   A- 82 -> 86, B+ 76 -> 80  (+4, absorbing the stretch)
//     A- and B+ span the gap between B and A. Lifting A by 5 and B by 3 widens
//     that span by 2, taken as +1 to the A- and B bands (widths 6/6/6/7/7/8/12
//     become 7/6/7/7/7/8/12). The ladder stays legible; no band doubles.
//
//   C+ 56 -> 59, C 48 -> 51, D 36 -> 39  (+3, tracking the centre)
//     Below the median the same level shift applies, for the same reason.
//
// VALIDATED ON FIVE REAL POOL SNAPSHOTS (2026-07-20 .. 08-02), in both row
// orderings (see the note in calibrationPool.fixture.json about tie order): A
// peaks at 3.7% and the median lands B-/C+ on every one. The 1.3-2.0pp of ceiling
// headroom is deliberate - it is wider than the ~1-3pp swing that pool row order
// alone can produce, so the next monitor read is not a coin flip.
export const BANDS = [
  ['A', 93], ['A-', 86], ['B+', 80], ['B', 73], ['B-', 66],
  ['C+', 59], ['C', 51], ['D', 39], ['F', -Infinity],
];
export function bandFor(score) {
  for (const [g, min] of BANDS) if (score >= min) return g;
  return 'F';
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const displayValue = (rec) => rec.overallPick - rec.adpAtPick; // positive-good

// userRecs: the user seat's engine pick records (slotPos, adpAtPick, overallPick,
// round, rosterSlot, bye, synthetic, needWeight). config: { teams_count, roster_slots }.
export function gradeDraft(userRecs, config) {
  const teams = config.teams_count;
  const skill = userRecs.filter((r) => SKILL.has(r.slotPos) && !r.synthetic);

  // (1) VALUE — display-value summed over QB/RB/WR/TE picks ONLY (K/DST +
  //     synthetic fillers excluded entirely), normalized by teams x skill picks
  //     so grades compare across 8/10/12-team presets.
  const rawValue = skill.reduce((a, r) => a + displayValue(r), 0);
  const nSkill = Math.max(1, skill.length);
  const normValue = rawValue / (teams * nSkill);
  const valueScore = clamp(50 + VALUE_K * normValue, 0, 100);

  // (2) CONSTRUCTION —
  //   (a) starters filled without end-game scrambling.
  const lateStarters = userRecs.filter((r) => STARTER_SKILL_SLOTS.has(r.rosterSlot) && r.round > STARTER_MIN_ROUND).length;
  //   (b) bench concentration: >60% of the bench at one position.
  const bench = userRecs.filter((r) => r.rosterSlot === 'BN');
  const benchByPos = {};
  for (const r of bench) benchByPos[r.slotPos] = (benchByPos[r.slotPos] ?? 0) + 1;
  const benchMax = bench.length ? Math.max(...Object.values(benchByPos)) : 0;
  const benchConcentrated = bench.length >= 3 && benchMax / bench.length > 0.6;
  //   (c) bye stacks (>=3 starters sharing a bye).
  const byeStacks = byeStackWarnings(userRecs);
  const constructionScore = clamp(100 - 12 * lateStarters - (benchConcentrated ? 15 : 0) - 10 * byeStacks.length, 0, 100);

  // (3) gradeScore.
  const gradeScore = VALUE_WEIGHT * valueScore + CONSTRUCTION_WEIGHT * constructionScore;
  const grade = bandFor(gradeScore);

  // (5) CALLOUTS — skill-only, min round 3 so round-1 noise never headlines.
  const pool = skill.filter((r) => r.round >= 3);
  const pv = (r) => r.adpAtPick - r.overallPick; // engine sign: negative = value
  const bestValue = pool.length ? pool.reduce((a, b) => (pv(b) < pv(a) ? b : a)) : null;
  const biggestReach = pool.length ? pool.reduce((a, b) => (pv(b) > pv(a) ? b : a)) : null;
  const rated = userRecs.filter((r) => r.needWeight != null);
  const pivot = rated.length ? rated.reduce((a, b) => (b.needWeight > a.needWeight ? b : a)) : null;

  return {
    grade,
    gradeScore: Number(gradeScore.toFixed(1)),
    components: {
      valueScore: Number(valueScore.toFixed(1)),
      constructionScore: Number(constructionScore.toFixed(1)),
      rawValue: Number(rawValue.toFixed(1)),
      normValue: Number(normValue.toFixed(3)),
      lateStarters,
      benchConcentration: { concentrated: benchConcentrated, max: benchMax, size: bench.length },
      byeStackCount: byeStacks.length,
      weights: { value: VALUE_WEIGHT, construction: CONSTRUCTION_WEIGHT },
    },
    callouts: { bestValue, biggestReach, pivot },
    byeStacks,
  };
}
