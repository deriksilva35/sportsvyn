// lib/cfb/boxScore.js - one CFB game's box score, read from OUR tables.
//
// SOURCE PER GAME STATE, DECIDED HERE AND NOWHERE ELSE. Two tables hold a CFB
// box score and they are never blended: cfb_live_player_lines carries the
// secondary feed's four groups while the game is being played, and
// cfb_player_game_stats carries the complete ten-group import once the game is
// over. cfbBoxScoreFor() is the one place that chooses. No page, component or
// reader downstream may look at a status and pick a table - they receive rows
// and a state, and they render what they were handed.
//
// THE BRIDGE WINDOW IS THE INTERESTING CASE. A game goes final ~35 minutes
// before the complete import lands, and during that gap the LAST LIVE SNAPSHOT
// is the freshest true thing we hold. Blanking the tab for half an hour after
// the whistle - at exactly the moment people open the page - would be choosing
// tidiness over truth. So the snapshot keeps rendering, labelled for what it
// is: a final score with a box score still coming.
//
// ONE SURFACE, ONE SOURCE. This reads our tables and nothing else.
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
/**
 * `sort` IS THE COLUMN A BOX SCORE IS READ BY. A reader opens the passing
 * table to see who threw for the most yards, not to find the alphabet. It is
 * declared per group rather than assumed to be the first column, because the
 * first column of the passing table is C/ATT and nobody ranks a quarterback by
 * attempts.
 */
export const CFB_GROUPS = Object.freeze([
  { group: 'passing', label: 'PASSING', primary: true, sort: 'pass_yds', cols: [
    [['pass_cmp', 'pass_att'], 'C/ATT'], ['pass_yds', 'YDS'], ['pass_td', 'TD'], ['pass_int', 'INT'],
  ] },
  { group: 'rushing', sort: 'rush_yds', label: 'RUSHING', primary: true, cols: [
    ['rush_car', 'CAR'], ['rush_yds', 'YDS'], ['rush_td', 'TD'], ['rush_long', 'LONG'],
  ] },
  { group: 'receiving', sort: 'rec_yds', label: 'RECEIVING', primary: true, cols: [
    ['rec', 'REC'], ['rec_yds', 'YDS'], ['rec_td', 'TD'], ['rec_long', 'LONG'],
  ] },
  // TFL AND SACKS ARE STRUCTURAL HERE. College box scores carry them on every
  // defensive line where the NFL feed does not, so the defensive table is
  // wider for CFB by the provider's own shape, not by our preference.
  { group: 'defensive', sort: 'tackles_tot', label: 'DEFENSE', primary: true, cols: [
    ['tackles_tot', 'TOT'], ['tackles_solo', 'SOLO'], ['tfl', 'TFL'], ['sacks', 'SACKS'],
    ['qb_hur', 'QB HUR'], ['pass_def', 'PD'], ['def_td', 'TD'],
  ] },
  { group: 'interceptions', sort: 'def_int', label: 'INTERCEPTIONS', primary: false, cols: [
    ['def_int', 'INT'], ['int_yds', 'YDS'], ['int_td', 'TD'],
  ] },
  { group: 'fumbles', sort: 'fum', label: 'FUMBLES', primary: false, cols: [
    ['fum', 'FUM'], ['fum_lost', 'LOST'], ['fum_rec', 'REC'],
  ] },
  { group: 'kicking', sort: 'kick_pts', label: 'KICKING', primary: false, cols: [
    [['fgm', 'fga'], 'FG'], [['xpm', 'xpa'], 'XP'], ['fg_long', 'LONG'], ['kick_pts', 'PTS'],
  ] },
  { group: 'punting', sort: 'punt_yds', label: 'PUNTING', primary: false, cols: [
    ['punts', 'NO'], ['punt_yds', 'YDS'], ['punt_long', 'LONG'], ['punt_in20', 'In 20'], ['punt_tb', 'TB'],
  ] },
  { group: 'kickReturns', sort: 'kr_yds', label: 'KICK RETURNS', primary: false, cols: [
    ['kr', 'NO'], ['kr_yds', 'YDS'], ['kr_td', 'TD'], ['kr_long', 'LONG'],
  ] },
  { group: 'puntReturns', sort: 'pr_yds', label: 'PUNT RETURNS', primary: false, cols: [
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
export function cfbTablesFor(rows, teamName, groups = CFB_GROUPS) {
  const mine = (rows ?? []).filter((r) => r.team_name === teamName);
  const out = [];
  for (const g of groups) {
    const keys = g.cols.flatMap(([k]) => (Array.isArray(k) ? k : [k]));
    const players = mine.filter((r) => keys.some((k) => r[k] != null));
    if (!players.length) continue;
    // LEADER FIRST, then the alphabet. A null sorts last rather than as a zero:
    // a defender with no tackle number is unranked, not the worst tackler.
    const sorted = [...players].sort((a, b) => {
      const x = a[g.sort], y = b[g.sort];
      if (x == null && y != null) return 1;
      if (y == null && x != null) return -1;
      if (x != null && y != null && Number(y) !== Number(x)) return Number(y) - Number(x);
      return String(a.full_name ?? '').localeCompare(String(b.full_name ?? ''));
    });
    out.push({
      group: g.group,
      label: g.label,
      primary: g.primary,
      headings: g.cols.map(([, h]) => h),
      showFpts: false,
      rows: sorted.map((p) => ({
        name: p.full_name,
        // IDENTITY RIDES THE ROW, and every field of it is optional. The live
        // feed hands position and jersey over for free, so no roster join is
        // made for them; the complete import gets the same two off the players
        // table it already joins. A row missing either renders without it.
        slug: p.slug ?? null,
        position: p.position ?? null,
        jersey: p.jersey_number ?? null,
        cells: g.cols.map(([k]) => (Array.isArray(k)
          // A pair with neither half is absent, not "-/-".
          ? (p[k[0]] == null && p[k[1]] == null ? ABSENT : `${fmtCell(p[k[0]])}/${fmtCell(p[k[1]])}`)
          : fmtCell(p[k]))),
      })),
    });
  }
  return out;
}

/**
 * THE FOUR GROUPS THE LIVE FEED CAN FILL, and only the columns it actually
 * carries.
 *
 * DERIVED FROM CFB_GROUPS, NEVER RETYPED, so the live table cannot drift out
 * of agreement with the complete one about what a passing line looks like. The
 * filter is against the columns migration 080 stores: the live DEFENSE table
 * is therefore narrower than the final one - no QB HUR, no defensive TD -
 * because the feed does not send them. A column of dashes would be a promise
 * we do not keep, so the column is absent instead.
 */
export const LIVE_COLUMNS = Object.freeze(['pass_cmp', 'pass_att', 'pass_yds', 'pass_td',
  'pass_int', 'rush_car', 'rush_yds', 'rush_td', 'rush_long', 'rec', 'rec_yds', 'rec_td',
  'rec_long', 'tackles_tot', 'tackles_solo', 'tfl', 'sacks', 'def_int', 'pass_def',
  'pass_qbr', 'pass_rating', 'rec_targets']);

export const CFB_LIVE_GROUPS = Object.freeze(CFB_GROUPS
  .filter((g) => g.primary)
  .map((g) => Object.freeze({
    ...g,
    cols: g.cols.filter(([k]) => (Array.isArray(k) ? k : [k]).every((c) => LIVE_COLUMNS.includes(c))),
  }))
  .filter((g) => g.cols.length));

/**
 * The COMPLETE box score for one match, or null when we hold nothing.
 *
 * NULL, NOT AN EMPTY ARRAY. The page's rule - copied from the NFL's - is that a
 * tab exists only when its data does, and `null` is the value that makes the
 * caller's `boxScore ? {...} : null` read correctly.
 */
export async function cfbBoxScore(matchId) {
  const cols = BOX_COLUMNS.map((c) => `g.${c}`).join(', ');
  const rows = await sql.query(
    `SELECT p.full_name, p.slug, p.position,
            p.current_team_jersey_number AS jersey_number,
            g.team_name, g.opponent, g.result, ${cols}
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

/**
 * The LIVE box score for one match, or null.
 *
 * THE PLAYER-PAGE LINK IS AN EXACT JOIN, NOT A GUESS. A live row carries a
 * name and a resolved team id and nothing else that identifies anybody; the
 * link is offered only where that pair matches one of our player rows exactly.
 * A row that does not resolve is NOT marked, footnoted or greyed - it renders
 * in the identical grammar, minus the link. Someone whose profile we do not
 * hold has still made the tackle.
 */
export async function cfbLiveBoxScore(matchId) {
  const cols = LIVE_COLUMNS.map((c) => `l.${c}`).join(', ');
  const rows = await sql.query(
    `SELECT trim(concat_ws(' ', l.first_name, l.last_name)) AS full_name,
            -- OUR TEAM NAME WHERE WE RESOLVED ONE. The live row stores the
            -- provider's own college string, which is not always ours - we say
            -- "St. Francis (PA)", the feed says "Saint Francis". The page
            -- matches a box-score team against the two sides of the game by
            -- NAME, so handing it the provider's spelling would leave the team
            -- toggle labelled in a second vocabulary. team_id was already
            -- resolved at write time; this just spends it.
            COALESCE(tm.name, l.team_name) AS team_name,
            l.position, l.jersey_number, p.slug, ${cols}
       FROM cfb_live_player_lines l
       LEFT JOIN teams tm ON tm.id = l.team_id
       LEFT JOIN players p
              ON p.current_team_id = l.team_id
             AND lower(p.full_name) = lower(trim(concat_ws(' ', l.first_name, l.last_name)))
      WHERE l.match_id = $1
      ORDER BY full_name`,
    [matchId],
  );
  if (!rows.length) return null;
  const teams = [...new Set(rows.map((r) => r.team_name))].filter(Boolean);
  return {
    teams: teams.map((t) => ({ name: t, tables: cfbTablesFor(rows, t, CFB_LIVE_GROUPS) })),
    count: rows.length,
  };
}

/**
 * THE SWITCH. One reader decides which table a game's box score comes from,
 * and hands back the rows with the STATE that produced them.
 *
 *   live                            -> the live overlay, four groups, 'live'
 *   final + complete rows exist     -> the complete import, ten groups, 'final'
 *   final + complete rows missing   -> the last live snapshot, 'bridge'
 *   anything else                   -> null
 *
 * THE ORDER OF THE TWO FINAL CASES IS THE WHOLE DESIGN. The complete import is
 * asked for FIRST and wins whenever it exists, so the overlay never survives
 * into a game whose real box score has landed. Only its absence falls through
 * to the snapshot, and the state says so, so the surface can label it rather
 * than pass a partial box score off as the finished one.
 *
 * A SCHEDULED GAME IS NULL EVEN IF ROWS EXIST. Rows before kickoff would mean
 * a mis-keyed write, and rendering them would publish the error.
 *
 * THE TWO READERS ARE INJECTABLE so the state machine can be tested for what
 * it actually promises - which table is asked FIRST, and what happens when one
 * of them is empty - without a database standing in for the question. Callers
 * pass nothing; the defaults are the real readers.
 */
export async function cfbBoxScoreFor(matchId, status, {
  readComplete = cfbBoxScore, readLive = cfbLiveBoxScore,
} = {}) {
  if (status === 'live') {
    const live = await readLive(matchId);
    return live ? { ...live, state: 'live' } : null;
  }
  if (status === 'final') {
    const complete = await readComplete(matchId);
    if (complete) return { ...complete, state: 'final' };
    const live = await readLive(matchId);
    return live ? { ...live, state: 'bridge' } : null;
  }
  return null;
}

/**
 * What the surface says above the tables. PURE.
 *
 * A LIVE BOX SCORE MUST SAY IT IS LIVE, because every number in it is going to
 * change, and a bridge box score must say what it is missing - otherwise a
 * reader takes four groups for the whole night's work. A settled final says
 * nothing at all: the absence of a caveat is the claim.
 */
export function boxScoreLabel(state) {
  if (state === 'live') return { text: 'LIVE', live: true };
  if (state === 'bridge') return { text: 'Final \u2014 complete box score pending', live: false };
  return null;
}
