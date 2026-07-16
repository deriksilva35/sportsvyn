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
export const BANDS = [
  ['A', 88], ['A-', 82], ['B+', 76], ['B', 70], ['B-', 63],
  ['C+', 56], ['C', 48], ['D', 36], ['F', -Infinity],
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
