// lib/mockNfl/rank.js - the NFL mock's SVP under any scoring (mon-3). PURE, browser + server.
//
// SVP ("our projection") = projected fantasy points per game x the games his team
// has LEFT this season. Projected FP/G blends this season with last season by how
// much of this season he has played: under 4 games, 50/50; 4 or more, 80/20. One
// season only: that season. A player with no line in either season (unknown, not
// zero) ranks after every projected player, in ADP order.

import { fppgOf, PPR } from './scoring.js';

export const EARLY_GAMES = 4;

/** { fppg, now, last, wNow, gp, games } - `games` is games left (the multiplier). */
export function projection(r, weights = PPR) {
  const now = fppgOf(r?.s, weights); const last = fppgOf(r?.s2, weights);
  const gp = Number(r?.s?.gp) || 0;
  const wNow = now != null && last != null ? (gp < EARLY_GAMES ? 0.5 : 0.8) : (now != null ? 1 : 0);
  const base = now != null && last != null ? wNow * now + (1 - wNow) * last : (now ?? last);
  return { fppg: base == null ? null : Math.round(base * 10) / 10, now, last, wNow, gp, games: Number(r?.rem) || 0 };
}

/** Rows -> the same rows with { fppg, sv, svp }, best first. `adpOf(row)` orders the unknowns. */
export function rankPool(rows, weights = PPR, { adpOf = (r) => r.adp } = {}) {
  const known = []; const unknown = [];
  for (const r of rows ?? []) {
    const pj = projection(r, weights);
    if (pj.fppg == null) unknown.push({ ...r, fppg: null, sv: 0 });
    else known.push({ ...r, fppg: pj.fppg, sv: Math.round(pj.fppg * pj.games) });
  }
  known.sort((a, b) => b.sv - a.sv || (Number(adpOf(a)) || 9999) - (Number(adpOf(b)) || 9999));
  unknown.sort((a, b) => (Number(adpOf(a)) || 9999) - (Number(adpOf(b)) || 9999));
  return [...known, ...unknown].map((r, i) => ({ ...r, svp: i + 1 }));
}
