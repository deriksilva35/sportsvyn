// lib/nba/fantasyPoints.js - what an NBA line is worth. PURE.
//
// THE SHAPE OF lib/mlb/fantasyPoints.js, ON PURPOSE: one frozen table per
// sport, owned by the sport and not by a game, so the next NBA game that pays
// in fantasy points (a league, a weekly) imports this file rather than writing
// a second copy that could drift from Tonight's Six.
//
// THE TABLE (ruling thu-17), verbatim:
//   PTS 1 · REB 1.25 · AST 1.5 · STL 2 · BLK 2 · TOV -0.5 · 3PM +0.5
//   double-double +1.5 · triple-double +3
//
// THE BONUSES STACK. A triple-double is also a double-double (it has two
// categories in double figures), so it is paid both: +1.5 and +3, 4.5 in all.
// That is the DraftKings reading of the same two lines, and it is the reading
// that makes the season average below honest - BDL's dd2 count includes the
// games that were also triple-doubles. FLAGGED in the build report for Derik.
//
// THE CATEGORIES FOR A DOUBLE: points, rebounds, assists, steals, blocks - the
// five the league counts. Turnovers and threes are not categories.
//
// THREES ARE ALREADY POINTS. A made three is 3 points at PTS 1 and then +0.5
// on top - 3.5 in all. Nothing here subtracts it from points.
//
// IT READS nba_player_game_stats (migration 119): counting stats only, the
// turnover column spelled `turnovers`. A row with dnp = true or no minutes is
// a line of zeros and scores 0 - a player who did not play is not a DNF.

export const NBA_POINTS = Object.freeze({
  pts: 1, reb: 1.25, ast: 1.5, stl: 2, blk: 2, tov: -0.5, fg3m: 0.5,
  doubleDouble: 1.5, tripleDouble: 3,
});

/**
 * The card's own words for its rules line, generated from the table. THE
 * STACK IS SAID (ruling sat-5 S2): a triple-double is paid both bonuses, so
 * the copy reads "DD +1.5, TD +3 (stack: +4.5)" - never "DD · TD" as if a
 * reader had to guess whether the second replaces the first.
 */
export const RULES_LINE = Object.freeze(
  `PTS ${NBA_POINTS.pts} · REB ${NBA_POINTS.reb} · AST ${NBA_POINTS.ast} · STL ${NBA_POINTS.stl} · BLK ${NBA_POINTS.blk} · TOV ${NBA_POINTS.tov} · 3PM +${NBA_POINTS.fg3m} · DD +${NBA_POINTS.doubleDouble}, TD +${NBA_POINTS.tripleDouble} (stack: +${NBA_POINTS.doubleDouble + NBA_POINTS.tripleDouble})`,
);

const n = (v) => {
  if (v == null || v === '') return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export const round1 = (x) => Math.round((Number(x) || 0) * 10) / 10;

/** The turnover column is `turnovers` in the table and `turnover` in BDL's feed. */
const tovOf = (row) => n(row?.turnovers ?? row?.turnover ?? row?.tov);

/** How many of the five categories reached ten. PURE. */
export function doubleDigitCats(row) {
  if (!row) return 0;
  return [row.pts, row.reb, row.ast, row.stl, row.blk].filter((v) => n(v) >= 10).length;
}

export const isDoubleDouble = (row) => doubleDigitCats(row) >= 2;
export const isTripleDouble = (row) => doubleDigitCats(row) >= 3;

/** One game line -> points, unrounded. */
export function rawPoints(row) {
  if (!row) return 0;
  const cats = doubleDigitCats(row);
  return n(row.pts) * NBA_POINTS.pts
    + n(row.reb) * NBA_POINTS.reb
    + n(row.ast) * NBA_POINTS.ast
    + n(row.stl) * NBA_POINTS.stl
    + n(row.blk) * NBA_POINTS.blk
    + tovOf(row) * NBA_POINTS.tov
    + n(row.fg3m) * NBA_POINTS.fg3m
    + (cats >= 2 ? NBA_POINTS.doubleDouble : 0)
    + (cats >= 3 ? NBA_POINTS.tripleDouble : 0);
}

/** One game line -> points, rounded to one decimal at the last moment. */
export const linePoints = (row) => round1(rawPoints(row));

/**
 * THE CHIPS A LIVE SLOT PRINTS, one per stat, each with its own points. PURE.
 * Every chip is shown even at zero (a reader watching a live game wants to see
 * "REB 0" rather than wonder whether rebounds are counted); DD/TD appears only
 * once earned.
 */
export function statChips(row) {
  if (!row) return [];
  const chip = (key, label, count, per) => ({ key, label, count: n(count), points: round1(n(count) * per) });
  const out = [
    chip('pts', 'PTS', row.pts, NBA_POINTS.pts),
    chip('reb', 'REB', row.reb, NBA_POINTS.reb),
    chip('ast', 'AST', row.ast, NBA_POINTS.ast),
    chip('stl', 'STL', row.stl, NBA_POINTS.stl),
    chip('blk', 'BLK', row.blk, NBA_POINTS.blk),
    chip('tov', 'TOV', tovOf(row), NBA_POINTS.tov),
    chip('fg3m', '3PM', row.fg3m, NBA_POINTS.fg3m),
  ];
  const cats = doubleDigitCats(row);
  if (cats >= 3) out.push({ key: 'td', label: 'TD', count: 1, points: round1(NBA_POINTS.doubleDouble + NBA_POINTS.tripleDouble) });
  else if (cats >= 2) out.push({ key: 'dd', label: 'DD', count: 1, points: NBA_POINTS.doubleDouble });
  return out;
}

/**
 * FANTASY POINTS PER GAME from a season-averages row. PURE.
 *
 * BDL's /nba/v1/season_averages/general (type=base) sends per-game averages
 * plus dd2 and td3 as season COUNTS with gp beside them. The averages go
 * through the same table; the bonuses are paid at their per-game rate. The
 * rounding is once, at the end.
 *
 * @param s  the row's `stats` object
 * @returns  number, or null when the player has no games
 */
export function seasonFppg(s) {
  const gp = n(s?.gp);
  if (!gp) return null;
  const perGame = n(s.pts) * NBA_POINTS.pts
    + n(s.reb) * NBA_POINTS.reb
    + n(s.ast) * NBA_POINTS.ast
    + n(s.stl) * NBA_POINTS.stl
    + n(s.blk) * NBA_POINTS.blk
    + n(s.tov ?? s.turnover) * NBA_POINTS.tov
    + n(s.fg3m) * NBA_POINTS.fg3m;
  const bonus = (n(s.dd2) * NBA_POINTS.doubleDouble + n(s.td3) * NBA_POINTS.tripleDouble) / gp;
  return round1(perGame + bonus);
}

/** "28 PTS · 9 REB · 7 AST" - the line a final slot prints. Null for nothing. */
export function nbaLine(row) {
  if (!row) return null;
  if (row.dnp) return 'DNP';
  const bits = [];
  bits.push(`${n(row.pts)} PTS`);
  if (n(row.reb)) bits.push(`${n(row.reb)} REB`);
  if (n(row.ast)) bits.push(`${n(row.ast)} AST`);
  if (n(row.stl)) bits.push(`${n(row.stl)} STL`);
  if (n(row.blk)) bits.push(`${n(row.blk)} BLK`);
  return bits.join(' · ');
}
