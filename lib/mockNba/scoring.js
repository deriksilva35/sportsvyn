// lib/mockNba/scoring.js - the NBA mock draft's scoring and its SVP ranking (sun-5, sun-7). PURE.
//
// SCORING PRESETS (Derik's rulings; names ruled mon-1): ESPN-style points (the
// default - shooting counted, made and missed) and Yahoo-style points (counting
// stats only, no shooting terms), plus CUSTOM - any point value per stat. A preset is a map stat -> points per unit.
//
// SVP ("our ranking"): fantasy points per game LAST SEASON under the chosen
// scoring, x EXPECTED GAMES. Expected games (sun-7 tune): last season's games
// played capped at 75; a season under 40 games counts as 60 (an injured year is
// not the player's real workload). Rookies have no line: they are placed by NBA
// draft slot relative to the veterans (lib/mockNba/rank.js).

export const STATS = Object.freeze([
  { key: 'pts', label: 'Points' },
  { key: 'fg3m', label: '3-pointers made' },
  { key: 'fga', label: 'Field goals attempted' },
  { key: 'fgm', label: 'Field goals made' },
  { key: 'fta', label: 'Free throws attempted' },
  { key: 'ftm', label: 'Free throws made' },
  { key: 'reb', label: 'Rebounds' },
  { key: 'ast', label: 'Assists' },
  { key: 'stl', label: 'Steals' },
  { key: 'blk', label: 'Blocks' },
  { key: 'tov', label: 'Turnovers' },
]);

export const POINTS_LEAGUE = Object.freeze({
  pts: 1, fg3m: 1, fga: -1, fgm: 2, fta: -1, ftm: 1, reb: 1, ast: 2, stl: 4, blk: 4, tov: -2,
});

export const SCORING_PRESETS = Object.freeze({
  standard: Object.freeze({ label: 'ESPN-style points', weights: POINTS_LEAGUE }),
  simple: Object.freeze({
    label: 'Yahoo-style points',
    weights: Object.freeze({ pts: 1, fg3m: 0, fga: 0, fgm: 0, fta: 0, ftm: 0, reb: 1.2, ast: 1.5, stl: 3, blk: 3, tov: -1 }),
  }),
});

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const tovOf = (s) => n(s?.tov ?? s?.turnover ?? s?.turnovers);

/** Fantasy points per game under `weights` from a per-game line, or null with no games. */
export function fppgWith(s, weights = POINTS_LEAGUE) {
  if (!s || !(n(s.gp) > 0)) return null;
  let v = 0;
  for (const { key } of STATS) v += (key === 'tov' ? tovOf(s) : n(s[key])) * n(weights[key]);
  return Math.round(v * 10) / 10;
}

/** The standard-points FP/G. */
export const fppg = (s) => fppgWith(s, POINTS_LEAGUE);

/** Expected games (sun-7): last GP capped at 75; under 40 GP counts as 60. */
export function expectedGames(gp) {
  const g = Math.round(n(gp));
  if (g < 40) return 60;
  return Math.min(75, g);
}

/** Season value: FP/G x expected games, whole points. */
export const svValue = (fp, gp) => (fp == null ? null : Math.round(fp * expectedGames(gp)));

/** A custom weight, clamped to -10..10 at one decimal. */
export const cleanWeight = (v) => Math.max(-10, Math.min(10, Math.round(n(v) * 10) / 10));
