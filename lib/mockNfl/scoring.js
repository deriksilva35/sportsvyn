// lib/mockNfl/scoring.js - the NFL mock draft's scoring (mon-3). PURE, browser + server.
//
// PRESETS (Derik's rulings): PPR (the default), Half PPR, Standard, plus CUSTOM -
// any point value per stat. Yards score per yard (0.04 = a point per 25 passing
// yards). KICKERS AND DEFENSES ARE APPROXIMATE, as everywhere on the site
// (lib/fantasy/scoring.js): field goals score flat (distance is not stored), and a
// defense scores sacks, takeaways and TDs only (points allowed is not stored).
//
// A pool row carries each season's stat TOTALS and games (`s` this season, `s2`
// last season: { gp, t: { passYds, ... } }), so any scoring re-ranks in the browser.

export const STATS = Object.freeze([
  { key: 'passYds', label: 'Passing yards' },
  { key: 'passTd', label: 'Passing TDs' },
  { key: 'int', label: 'Interceptions thrown' },
  { key: 'rushYds', label: 'Rushing yards' },
  { key: 'rushTd', label: 'Rushing TDs' },
  { key: 'rec', label: 'Receptions' },
  { key: 'recYds', label: 'Receiving yards' },
  { key: 'recTd', label: 'Receiving TDs' },
  { key: 'fumblesLost', label: 'Fumbles lost' },
  { key: 'fgm', label: 'Field goals made' },
  { key: 'xp', label: 'Extra points made' },
  { key: 'sacks', label: 'Sacks (D/ST)' },
  { key: 'defInt', label: 'Interceptions (D/ST)' },
  { key: 'fr', label: 'Fumble recoveries (D/ST)' },
  { key: 'defTd', label: 'Defensive TDs (D/ST)' },
]);

const BASE = { passYds: 0.04, passTd: 4, int: -2, rushYds: 0.1, rushTd: 6, recYds: 0.1, recTd: 6, fumblesLost: -2, fgm: 3, xp: 1, sacks: 1, defInt: 2, fr: 2, defTd: 6 };

export const SCORING_PRESETS = Object.freeze({
  ppr: Object.freeze({ label: 'PPR', weights: Object.freeze({ ...BASE, rec: 1 }) }),
  half: Object.freeze({ label: 'Half PPR', weights: Object.freeze({ ...BASE, rec: 0.5 }) }),
  standard: Object.freeze({ label: 'Standard', weights: Object.freeze({ ...BASE, rec: 0 }) }),
});
export const PPR = SCORING_PRESETS.ppr.weights;

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Fantasy points per game from a season line { gp, t }, or null without games. */
export function fppgOf(line, weights = PPR) {
  if (!line || !(n(line.gp) > 0)) return null;
  let v = 0;
  for (const { key } of STATS) v += n(line.t?.[key]) * n(weights[key]);
  return Math.round((v / n(line.gp)) * 10) / 10;
}

/** A custom value, clamped to -10..10 at two decimals (0.04 a passing yard is real). */
export const cleanWeight = (v) => Math.max(-10, Math.min(10, Math.round(n(v) * 100) / 100));
