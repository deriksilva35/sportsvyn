// lib/mockNba/rank.js - SVP under any scoring (sun-7, sun-8 v2). PURE, browser + server.
//
// Pool rows carry last season's per-game line (`s`) and the season before's
// (`s2`). PROJECTED FP/G = 0.65 x last + 0.35 x before (a player with one season
// - a second-year player, or one who missed a year - uses that one), then the
// AGE CURVE on that number, by age in the season being drafted (the feed's age
// last season + 1): <=22 +8%, 23-25 +4%, 26-30 0, 31-33 -4%, 34+ -8%. A season
// under MIN_GP games is too thin to count. Season value = projected FP/G x 75.
// This year's first-round ROOKIES (no line) are placed by draft slot: the #1 pick just below the veteran ranked ROOKIE_BASE, each later pick
// ROOKIE_STEP ranks lower. The sun-7 tune moved the base from 40 to 65 and the
// step from 4 to 6 so the top rookies land near where the market drafts them
// (docs/reports/2026-10-11-mock-nba-2.md has the before/after).

import { fppgWith, svValue, POINTS_LEAGUE } from './scoring.js';

export const ROOKIE_BASE = 65;
export const ROOKIE_STEP = 6;
export const W_LAST = 0.65;
export const MIN_GP = 10;

/** The age-curve multiplier for an age in the season being drafted (null: none). */
export function ageFactor(age) {
  if (age == null || !Number.isFinite(Number(age))) return 1;
  const a = Number(age);
  if (a <= 22) return 1.08;
  if (a <= 25) return 1.04;
  if (a <= 30) return 1;
  if (a <= 33) return 0.96;
  return 0.92;
}

/** A row's age in the season being drafted, from the feed's age on its latest line. */
export function ageOf(r) {
  const a = Number(r?.s?.age);
  if (!r?.s || !Number.isFinite(a) || a <= 0) return null;
  return a + (r.prior ? 2 : 1);
}

/**
 * The projection behind SVP: { fppg, last, before, wLast, age, factor }. `fppg`
 * is the projected FP/G (rounded to 1 dp), or null without a usable line.
 */
export function projection(r, weights = POINTS_LEAGUE) {
  const ok = (s) => s && Number(s.gp) >= MIN_GP;
  const L = ok(r?.s) ? fppgWith(r.s, weights) : null;
  const P = !r?.prior && ok(r?.s2) ? fppgWith(r.s2, weights) : null;
  const one = L ?? (r?.s ? fppgWith(r.s, weights) : null);
  const base = L != null && P != null ? W_LAST * L + (1 - W_LAST) * P : (L ?? P ?? one);
  const age = ageOf(r); const factor = ageFactor(age);
  const wLast = L != null && P != null ? W_LAST : (L != null || P == null ? 1 : 0);
  return { fppg: base == null ? null : Math.round(base * factor * 10) / 10, last: L, before: P, wLast, age, factor };
}

/**
 * Rows -> the same rows with { fppg, sv, svp } for `weights`, best first.
 * `svp` is the 1-based SVP rank.
 */
export function rankPool(rows, weights = POINTS_LEAGUE, { rookieBase = ROOKIE_BASE, rookieStep = ROOKIE_STEP } = {}) {
  const vets = []; const rookies = [];
  for (const r of rows ?? []) {
    if (r.rookie) { rookies.push({ ...r }); continue; }
    // A row from before sun-7 has no line, only its stored value: it keeps that.
    if (!r.s) { vets.push({ ...r, sv: Number(r.sv) || 0 }); continue; }
    const fp = projection(r, weights).fppg;
    vets.push({ ...r, fppg: fp, sv: svValue(fp) ?? 0 });
  }
  vets.sort((a, b) => b.sv - a.sv || a.name.localeCompare(b.name));
  for (const r of rookies) {
    const at = Math.min(vets.length - 1, rookieBase - 1 + (Math.max(1, Number(r.draftNumber) || 30) - 1) * rookieStep);
    r.fppg = null;
    r.sv = at >= 0 ? vets[at].sv - 1 : 0;
  }
  return [...vets, ...rookies]
    .sort((a, b) => b.sv - a.sv || a.name.localeCompare(b.name))
    .map((r, i) => ({ ...r, svp: i + 1, rank: i + 1 }));
}
