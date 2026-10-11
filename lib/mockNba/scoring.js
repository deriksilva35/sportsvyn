// lib/mockNba/scoring.js - the NBA mock draft's points-league scoring and its
// "SV rank" (sun-5). PURE.
//
// THE PRESET (Derik's ruling): PTS 1, 3PM 1, FGA -1, FGM 2, FTA -1, FTM 1,
// REB 1, AST 2, STL 4, BLK 4, TO -2 - a standard points league, NOT the
// Tonight's Six table (lib/nba/fantasyPoints.js), which is a different game.
//
// SV VALUE = fantasy points per game LAST SEASON x expected games. Expected
// games is last season's games played (capped at 82): the honest, explainable
// number - a player who missed half the year carries that risk into the rank.

export const POINTS_LEAGUE = Object.freeze({
  pts: 1, fg3m: 1, fga: -1, fgm: 2, fta: -1, ftm: 1, reb: 1, ast: 2, stl: 4, blk: 4, turnover: -2,
});
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Fantasy points per game from a BDL season-averages `stats` row (or null if no games). */
export function fppg(s) {
  if (!s || !(n(s.gp) > 0)) return null;
  const tov = s.turnover ?? s.tov ?? s.turnovers;
  const v = n(s.pts) * POINTS_LEAGUE.pts + n(s.fg3m) * POINTS_LEAGUE.fg3m + n(s.fga) * POINTS_LEAGUE.fga
    + n(s.fgm) * POINTS_LEAGUE.fgm + n(s.fta) * POINTS_LEAGUE.fta + n(s.ftm) * POINTS_LEAGUE.ftm
    + n(s.reb) * POINTS_LEAGUE.reb + n(s.ast) * POINTS_LEAGUE.ast + n(s.stl) * POINTS_LEAGUE.stl
    + n(s.blk) * POINTS_LEAGUE.blk + n(tov) * POINTS_LEAGUE.turnover;
  return Math.round(v * 10) / 10;
}

export const expectedGames = (gp) => Math.min(82, Math.max(0, Math.round(n(gp))));

/** Season value: FP/G x expected games, whole points. */
export const svValue = (fp, gp) => (fp == null ? null : Math.round(fp * expectedGames(gp)));
