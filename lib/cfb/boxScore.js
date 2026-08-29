// lib/cfb/boxScore.js - one CFB game's box score, read from OUR table.
//
// ONE SURFACE, ONE SOURCE. This reads cfb_player_game_stats and nothing else.
// It does not call CFBD at render time and it does not import: the week
// importer (gameStatsImport.js) owns the write, this owns the read, and the
// page owns neither. A render-time provider call would put the game page's
// latency and its correctness at the mercy of a third party on every request.
//
// THE COLUMN VOCABULARY IS CFBD'S OWN, per the per-code column truth: a
// college passing line is C/ATT, not CMP and ATT in separate columns, and a
// carry is CAR. 078 already stores the halves separately (pass_cmp, pass_att)
// because the season endpoint sends them apart; the PAIR below puts them back
// together for display, which is the form a reader recognises.
//
// THE TABLE SHAPE IS THE NFL PAGE'S, deliberately - {group, label, primary,
// headings, rows:[{name, cells}]} is exactly what linesByGroup returns, so the
// same GameTabs component renders both codes without learning a second shape.
// The one field it does NOT carry is fantasy points: CFB has no scoring format
// in this product, and an empty FPTS column would be a promise we do not keep.

import { sql } from '../db.js';

const ABSENT = '–';

/**
 * Display groups, in the order a box score is read. PRIMARY are the four a
 * reader wants first; the rest are behind the "all groups" toggle the NFL page
 * already has.
 *
 * PAIRS render as "20/32" from two stored columns. Everything else is one
 * column, one cell.
 */
export const CFB_GROUPS = Object.freeze([
  { group: 'passing', label: 'PASSING', primary: true, cols: [
    [['pass_cmp', 'pass_att'], 'C/ATT'], ['pass_yds', 'YDS'], ['pass_td', 'TD'], ['pass_int', 'INT'],
  ] },
  { group: 'rushing', label: 'RUSHING', primary: true, cols: [
    ['rush_car', 'CAR'], ['rush_yds', 'YDS'], ['rush_td', 'TD'], ['rush_long', 'LONG'],
  ] },
  { group: 'receiving', label: 'RECEIVING', primary: true, cols: [
    ['rec', 'REC'], ['rec_yds', 'YDS'], ['rec_td', 'TD'], ['rec_long', 'LONG'],
  ] },
  // TFL AND SACKS ARE STRUCTURAL HERE. College box scores carry them on every
  // defensive line where the NFL feed does not, so the defensive table is
  // wider for CFB by the provider's own shape, not by our preference.
  { group: 'defensive', label: 'DEFENSE', primary: true, cols: [
    ['tackles_tot', 'TOT'], ['tackles_solo', 'SOLO'], ['tfl', 'TFL'], ['sacks', 'SACKS'],
    ['qb_hur', 'QB HUR'], ['pass_def', 'PD'], ['def_td', 'TD'],
  ] },
  { group: 'interceptions', label: 'INTERCEPTIONS', primary: false, cols: [
    ['def_int', 'INT'], ['int_yds', 'YDS'], ['int_td', 'TD'],
  ] },
  { group: 'fumbles', label: 'FUMBLES', primary: false, cols: [
    ['fum', 'FUM'], ['fum_lost', 'LOST'], ['fum_rec', 'REC'],
  ] },
  { group: 'kicking', label: 'KICKING', primary: false, cols: [
    [['fgm', 'fga'], 'FG'], [['xpm', 'xpa'], 'XP'], ['fg_long', 'LONG'], ['kick_pts', 'PTS'],
  ] },
  { group: 'punting', label: 'PUNTING', primary: false, cols: [
    ['punts', 'NO'], ['punt_yds', 'YDS'], ['punt_long', 'LONG'], ['punt_in20', 'In 20'], ['punt_tb', 'TB'],
  ] },
  { group: 'kickReturns', label: 'KICK RETURNS', primary: false, cols: [
    ['kr', 'NO'], ['kr_yds', 'YDS'], ['kr_td', 'TD'], ['kr_long', 'LONG'],
  ] },
  { group: 'puntReturns', label: 'PUNT RETURNS', primary: false, cols: [
    ['pr', 'NO'], ['pr_yds', 'YDS'], ['pr_td', 'TD'], ['pr_long', 'LONG'],
  ] },
]);

/** The stored columns this module reads - the SELECT list, derived from the
 *  display spec so a new column cannot be displayed without being fetched. */
export const BOX_COLUMNS = Object.freeze([...new Set(
  CFB_GROUPS.flatMap((g) => g.cols.flatMap(([k]) => (Array.isArray(k) ? k : [k]))),
)]);

const fmtCell = (v) => (v == null ? ABSENT : String(v));

/**
 * One team's tables from already-fetched rows. PURE - no database, so the
 * grouping rules are testable without one.
 *
 * A GROUP WITH NO NUMBERS DOES NOT RENDER. A player appears in
 * cfb_player_game_stats once per game with every column on one wide row, so
 * "did he catch a pass" is not "is there a receiving row" - it is "is any
 * receiving column non-null". Without that test every game would show ten
 * tables, eight of them full of dashes.
 */
export function cfbTablesFor(rows, teamName) {
  const mine = (rows ?? []).filter((r) => r.team_name === teamName);
  const out = [];
  for (const g of CFB_GROUPS) {
    const keys = g.cols.flatMap(([k]) => (Array.isArray(k) ? k : [k]));
    const players = mine.filter((r) => keys.some((k) => r[k] != null));
    if (!players.length) continue;
    out.push({
      group: g.group,
      label: g.label,
      primary: g.primary,
      headings: g.cols.map(([, h]) => h),
      showFpts: false,
      rows: players.map((p) => ({
        name: p.full_name,
        cells: g.cols.map(([k]) => (Array.isArray(k)
          // A pair with neither half is absent, not "–/–".
          ? (p[k[0]] == null && p[k[1]] == null ? ABSENT : `${fmtCell(p[k[0]])}/${fmtCell(p[k[1]])}`)
          : fmtCell(p[k]))),
      })),
    });
  }
  return out;
}

/**
 * The whole box score for one match, or null when we hold nothing.
 *
 * NULL, NOT AN EMPTY ARRAY. The page's rule - copied from the NFL's - is that a
 * tab exists only when its data does, and `null` is the value that makes the
 * caller's `boxScore ? {...} : null` read correctly.
 */
export async function cfbBoxScore(matchId) {
  const cols = BOX_COLUMNS.map((c) => `g.${c}`).join(', ');
  const rows = await sql.query(
    `SELECT p.full_name, g.team_name, g.opponent, g.result, ${cols}
       FROM cfb_player_game_stats g
       JOIN players p ON p.id = g.player_id
      WHERE g.match_id = $1
      ORDER BY p.full_name`,
    [matchId],
  );
  if (!rows.length) return null;
  // Team order is the payload's, which is home then away; the caller re-orders
  // to away-then-home to match the scoreboard if it wants to.
  const teams = [...new Set(rows.map((r) => r.team_name))].filter(Boolean);
  return { teams: teams.map((t) => ({ name: t, tables: cfbTablesFor(rows, t) })), count: rows.length };
}
