// lib/mockNba/rank.js - SVP under any scoring (sun-7). PURE, browser + server.
//
// Pool rows carry last season's per-game line (`s`). rankPool scores every
// veteran under the chosen weights (lib/mockNba/scoring.js), orders them by
// season value, and places this year's first-round ROOKIES (no line) by draft
// slot: the #1 pick just below the veteran ranked ROOKIE_BASE, each later pick
// ROOKIE_STEP ranks lower. The sun-7 tune moved the base from 40 to 65 and the
// step from 4 to 6 so the top rookies land near where the market drafts them
// (docs/reports/2026-10-11-mock-nba-2.md has the before/after).

import { fppgWith, svValue, POINTS_LEAGUE } from './scoring.js';

export const ROOKIE_BASE = 65;
export const ROOKIE_STEP = 6;

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
    const fp = fppgWith(r.s, weights);
    vets.push({ ...r, fppg: fp, sv: svValue(fp, r.s.gp) ?? 0 });
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
