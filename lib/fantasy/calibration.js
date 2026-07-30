// lib/fantasy/calibration.js — measure the grade distribution over a corpus of
// seeded full-auto drafts. ONE implementation, two very different callers:
//
//   · grade.test.mjs runs it against a CHECKED-IN pool fixture. That is a test of
//     the GRADER: same pool + same seeds => same numbers, forever. A failure there
//     means grade.js or engine.js changed behaviour.
//
//   · /api/cron/adp-snapshot runs it against the pool it just wrote. That is
//     MONITORING, not a test: the realized A-rate drifts as FFC's board changes,
//     and we want to know when it drifts persistently rather than pretend a live
//     number can be asserted. Band edges are never retuned on one day's reading.
//
// The stated calibration principle ("an unattended draft is an average draft" —
// median lands B-/C+, A is at most 5% of auto-drafts) is a claim about the BANDS.
// Keeping the fixture run and the live run in the same function is what stops the
// two from silently measuring different things.

import { runFullDraft, makeRng } from './engine.js';
import { gradeDraft, bandFor } from './grade.js';

// The corpus shape the calibration was established with: 300 drafts, cycling the
// preset configs and the seat within each, seeds 5000..5299. Changing any of these
// invalidates comparison against the recorded distribution, so they are named
// constants rather than call-site literals.
export const CORPUS_DRAFTS = 300;
export const CORPUS_SEED_BASE = 5000;

// The stated ceiling on A grades among unattended drafts.
export const A_CEILING_PCT = 5;

// Consecutive days over the ceiling before it is worth an email. One day over is
// noise from FFC's board turning over; three in a row is a trend.
export const A_BREACH_STREAK = 3;

const GRADE_ORDER = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D', 'F'];

/**
 * Group pool rows into per-preset pools and attach them to their configs.
 * @param presets rows of { name, teams_count, scoring_format, roster_slots }
 * @param rows    sim_player_pool rows (snake_case, one snapshot_date)
 * @returns configs with a `pool` array each; configs with no pool are dropped.
 */
export function poolConfigs(presets, rows) {
  const byPair = new Map();
  for (const r of rows) {
    const k = `${r.scoring_format}/${r.teams_count}`;
    if (!byPair.has(k)) byPair.set(k, []);
    byPair.get(k).push({
      ffcPlayerId: r.ffc_player_id,
      name: r.name,
      position: r.position,
      team: r.team,
      adp: Number(r.adp),
      stdev: r.stdev == null ? null : Number(r.stdev),
      bye: r.bye,
    });
  }
  return presets
    .map((c) => ({ ...c, pool: byPair.get(`${c.scoring_format}/${c.teams_count}`) }))
    .filter((c) => c.pool?.length);
}

/**
 * Run the corpus and describe the grade distribution.
 * Deterministic for a given (configs, pool contents) — the RNG is seeded per draft.
 * @returns { drafts, median, medianBand, aPct, histogram, p25, p75 }
 */
export function measureCalibration(configs, { drafts = CORPUS_DRAFTS, seedBase = CORPUS_SEED_BASE } = {}) {
  if (!configs?.length) throw new Error('measureCalibration: no configs with pools');
  const scores = [];
  const histogram = {};
  for (let i = 0; i < drafts; i++) {
    const cfg = configs[i % configs.length];
    const seat = (i % cfg.teams_count) + 1;
    const res = runFullDraft(cfg, cfg.pool, seat, { auto: true }, makeRng(seedBase + i));
    const g = gradeDraft(res.picks.filter((p) => p.isUser), cfg);
    scores.push(g.gradeScore);
    histogram[g.grade] = (histogram[g.grade] ?? 0) + 1;
  }
  scores.sort((a, b) => a - b);
  const q = (p) => scores[Math.floor(p * (scores.length - 1))];
  const median = q(0.5);
  return {
    drafts,
    median: Math.round(median * 10) / 10,
    medianBand: bandFor(median),
    aPct: Math.round(((histogram.A ?? 0) / drafts) * 1000) / 10,
    p25: Math.round(q(0.25) * 10) / 10,
    p75: Math.round(q(0.75) * 10) / 10,
    histogram: Object.fromEntries(GRADE_ORDER.map((g) => [g, histogram[g] ?? 0])),
  };
}

/**
 * Pure: how many trailing readings are over the ceiling. `series` is
 * newest-first. A null/undefined reading breaks the streak — an unmeasured day is
 * not evidence of a breach.
 */
export function breachStreak(series, ceiling = A_CEILING_PCT) {
  let n = 0;
  for (const v of series ?? []) {
    if (typeof v !== 'number' || Number.isNaN(v) || v <= ceiling) break;
    n += 1;
  }
  return n;
}

/**
 * Pure: should today's reading raise the alarm? True only when the trailing run of
 * over-ceiling readings (today included, newest-first) reaches the streak length.
 */
export function shouldAlertCalibration(series, { ceiling = A_CEILING_PCT, streak = A_BREACH_STREAK } = {}) {
  return breachStreak(series, ceiling) >= streak;
}
