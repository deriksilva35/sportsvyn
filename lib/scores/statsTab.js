// lib/scores/statsTab.js - the Scoreboard's Stats tab (sun-1), PURE.
//
// A fantasy dashboard for the selected day: one row per player who has played,
// sorted by fantasy points, for NFL (PPR) and NBA (ESPN points). Everything the
// page and the board must decide lives here so a fixture can pin it:
//   · the tab cookie           (sv_scores_tab, the pattern of sv_top25)
//   · the two calculators      nflPoints / nbaPoints - the PRODUCT'S scorers,
//                              imported, never re-derived (see below)
//   · the stat lines, the game tag ("BUF v MIA" / "MIA @ BUF") and the pills
//   · shapeRows                raw reads -> the rows the board draws
//   · statsView                rows + tiles + chips, with the SIGNED-OUT shape
//   · filterRows               search / position / status / mine (the client's)
//
// THE CALCULATORS ARE THE PRODUCT'S. NFL: fantasyPoints(toStatLine(row), 'ppr')
// - exactly what the Weekly settles and scores live with (lib/weekly/settle.js,
// lib/weekly/seasonLine.js). NBA: espnLinePoints - the NBA Nightly's table
// (lib/nba/fantasyPoints.js). A DST has no line in the Weekly (its pool is QB,
// RB, WR, TE); it is scored with scoring.js's own defense terms (sack 1, INT 2,
// fumble recovery 2, defensive TD 6) and nothing else - points and yards
// allowed are not stored, so a DST's number is PARTIAL and the tab says so.

import { fantasyPoints } from '../fantasy/scoring.js';
import { toStatLine, toDefenseLine } from '../fantasy/playerStats.js';
import { statLine } from '../daily/reveal.js';
import { espnLinePoints } from '../nba/fantasyPoints.js';
import { nbaLiveLabel, nbaFinalLabel, finalPeriodOf } from '../nba/card.js';
import { pairHasHeadgear } from '../teams/headgear.js';
import { TAB_COOKIE, TABS, wantTab, tabCookieString, STATUS_CYCLE, STATUS_WORDS, filterRows } from './statsFilter.js';

export { TAB_COOKIE, TABS, wantTab, tabCookieString, STATUS_CYCLE, STATUS_WORDS, filterRows };

// ---------------------------------------------------------------- the tab cookie

/** The server's read of the cookie (dynamic import: loadable from plain node tests). */
export async function readRememberedTab() {
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get(TAB_COOKIE)?.value ?? null;
  } catch { return null; }
}

// ---------------------------------------------------------------- sports

/** Sports the tab can score today. Every other chip says "coming soon". */
export const STATS_SPORTS = Object.freeze(['nfl', 'nba']);
export const STATS_CHIPS = Object.freeze([['nfl', 'NFL'], ['cfb', 'CFB'], ['mlb', 'MLB'], ['nba', 'NBA'], ['epl', 'EPL']]);
export const SPORT_NAME = Object.freeze({ nfl: 'NFL', cfb: 'CFB', mlb: 'MLB', nba: 'NBA', epl: 'EPL', ucl: 'UCL' });

/** The tab's sport: NFL unless the URL names another known one ("all" has no stats board). */
export function statsSport(raw) {
  return Object.hasOwn(SPORT_NAME, raw) ? raw : 'nfl';
}

export const REFRESH_MS = 30_000;
export const CACHE_SECONDS = 30;

// ---------------------------------------------------------------- the calculators

const num = (v) => Number(v ?? 0) || 0;
const round1 = (x) => Math.round(x * 10) / 10;

/** The position vocabulary the board prints: BDL's PK is K, the synthetic DEF is DST. */
export const nflPos = (p) => (p === 'PK' ? 'K' : p === 'DEF' ? 'DST' : p);

/** PPR points for one NFL stat row (snake_case columns, as the table has them). */
export function nflPoints(row) {
  if (row.position === 'DEF' || row.position === 'DST') return fantasyPoints(toDefenseLine(row), 'ppr');
  return fantasyPoints(toStatLine(row), 'ppr');
}

/** ESPN points for one NBA stat row (the table's `turnovers` column spelling). */
export const nbaPoints = (row) => espnLinePoints(row);

const NFL_COLS = ['pass_cmp', 'pass_att', 'pass_yds', 'pass_td', 'pass_int', 'rush_att', 'rush_yds', 'rush_td',
  'tgt', 'rec', 'rec_yds', 'rec_td', 'fumbles_lost', 'fgm', 'fga', 'xp', 'sacks', 'def_int', 'fr', 'def_td'];

/** Has this NFL row any recorded activity at all (a rostered man with an empty line has not played). */
export const nflPlayed = (row) => NFL_COLS.some((c) => num(row[c]) !== 0);

/** Has this NBA row a played line (a DNP, or no minutes and no counting stat, has not). */
export function nbaPlayed(row) {
  if (row.dnp) return false;
  if (num(row.seconds) > 0) return true;
  return ['pts', 'reb', 'ast', 'stl', 'blk', 'fga', 'fta', 'turnovers'].some((c) => num(row[c]) !== 0);
}

// ---------------------------------------------------------------- the stat lines

const dot = (s) => (s == null ? s : s.replaceAll(', ', ' · '));

/** "24/33 · 312 yds · 3 TD · 0 INT" and its position cousins, one line. */
export function nflStatLine(row) {
  const pos = nflPos(row.position);
  if (pos === 'DST') {
    const bits = [];
    const s = num(row.sacks);
    bits.push(`${s} sack${s === 1 ? '' : 's'}`);
    if (num(row.def_int)) bits.push(`${num(row.def_int)} INT`);
    if (num(row.fr)) bits.push(`${num(row.fr)} FR`);
    if (num(row.def_td)) bits.push(`${num(row.def_td)} TD`);
    return bits.join(' · ');
  }
  if (pos === 'K') return `${num(row.fgm)}/${num(row.fga)} FG · ${num(row.xp)} XP`;
  return dot(statLine(pos, toStatLine(row))) ?? '—';
}

/** "28 pts · 14 reb · 9 ast · 1 stl": the three counting stats, then whatever else happened. */
export function nbaStatLine(row) {
  const bits = [`${num(row.pts)} pts`, `${num(row.reb)} reb`, `${num(row.ast)} ast`];
  if (num(row.stl)) bits.push(`${num(row.stl)} stl`);
  if (num(row.blk)) bits.push(`${num(row.blk)} blk`);
  if (num(row.fg3m)) bits.push(`${num(row.fg3m)} 3pm`);
  return bits.join(' · ');
}

// ---------------------------------------------------------------- the game side

/** "BUF v MIA" at home, "MIA @ BUF" away: the player's team first. */
export function gameTag(team, opp, home) {
  return home ? `${team} v ${opp}` : `${team} @ ${opp}`;
}

/** The LIVE pill's words: "Q4 · 3:12" (NFL), "Q3 · 6:02" / "Half" (NBA). */
export function liveWords(league, ls) {
  if (league === 'nba') return nbaLiveLabel(ls ?? {});
  const q = ls?.period ?? null; const c = ls?.clock ?? null;
  return q ? `${Number(q) >= 5 ? 'OT' : `Q${q}`}${c ? ` · ${c}` : ''}` : 'Live';
}

/** The FINAL pill's words ("Final", or "Final · OT" for an NBA overtime). */
export function finalWords(league, lineScore) {
  return league === 'nba' ? nbaFinalLabel(finalPeriodOf({ line_score: lineScore ?? [] })) : 'Final';
}

// ---------------------------------------------------------------- the rows

/** Stable identity for the "in your games" lookup: an NFL player id, or a BDL player id. */
export const keyOf = (league, row) => (league === 'nba' ? `b:${row.bdl_player_id}` : `n:${row.nfl_player_id}`);

/**
 * Raw reads -> the board's rows, sorted by points (desc), ranked. PURE.
 * @param league  'nfl' | 'nba'
 * @param games   [{ id, status, homeId, awayId, homeAbbr, awayAbbr, homeName, awayName, homeC1, homeC2, awayC1, awayC2, ls, lineScore }]
 * @param stats   the stat rows (match_id, team_id, name/player_name, position, stat columns; DST rows carry position 'DEF')
 */
export function shapeRows(league, games, stats) {
  const byGame = new Map(games.map((g) => [Number(g.id), g]));
  const out = [];
  for (const r of stats) {
    const g = byGame.get(Number(r.match_id));
    if (!g) continue;
    const isNba = league === 'nba';
    if (isNba ? !nbaPlayed(r) : !nflPlayed(r)) continue;
    const home = Number(r.team_id) === Number(g.homeId);
    if (!home && Number(r.team_id) !== Number(g.awayId)) continue;
    const team = home ? g.homeAbbr : g.awayAbbr;
    const opp = home ? g.awayAbbr : g.homeAbbr;
    const pos = isNba ? (r.position || '—') : nflPos(r.position);
    const dst = !isNba && pos === 'DST';
    const live = g.status === 'live';
    out.push({
      key: dst ? `d:${r.team_id}` : keyOf(league, r),
      gameId: Number(g.id),
      name: dst ? `${(home ? g.homeName : g.awayName) ?? team} D/ST` : (isNba ? r.player_name : r.name),
      pos, team, opp,
      home,
      tag: gameTag(team, opp, home),
      gameKey: [g.awayAbbr, g.homeAbbr].sort().join('-'),
      status: live ? 'live' : 'final',
      pill: live ? liveWords(league, g.ls) : finalWords(league, g.lineScore),
      line: isNba ? nbaStatLine(r) : nflStatLine(r),
      pts: isNba ? nbaPoints(r) : nflPoints(r),
      c1: home ? g.homeC1 : g.awayC1, c2: home ? g.homeC2 : g.awayC2,
      headgear: pairHasHeadgear(league, g.awayAbbr, g.homeAbbr),
      inMine: false,
    });
  }
  out.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
  return out.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Mark the viewer's players. Signed out (mine = null) leaves every row untagged. */
export function tagMine(rows, mine) {
  if (!mine) return rows;
  return rows.map((r) => (mine.has(r.key) ? { ...r, inMine: true } : r));
}

// ---------------------------------------------------------------- tiles and chips

/** The three tiles. `yours` is null signed out - the tile is not drawn at all. */
export function tilesOf(rows, { signedIn }) {
  const top = rows[0] ?? null;
  const byGame = new Map();
  for (const r of rows) {
    const g = byGame.get(r.gameId) ?? { tag: null, pts: 0, away: null, home: null };
    g.pts += r.pts;
    if (r.home) g.home = r.team; else g.away = r.team;
    byGame.set(r.gameId, g);
  }
  let big = null;
  for (const g of byGame.values()) {
    if (!big || g.pts > big.pts) big = g;
  }
  const mine = rows.filter((r) => r.inMine);
  return {
    top: top ? { name: top.name, pts: top.pts } : null,
    yours: signedIn ? { count: mine.length, pts: round1(mine.reduce((a, r) => a + r.pts, 0)) } : null,
    biggest: big ? { tag: `${big.away ?? '?'} @ ${big.home ?? '?'}`, pts: round1(big.pts) } : null,
  };
}

const NFL_POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];

/** Position chips: All plus only the positions the day's data holds. NBA's come as G / F / C. */
export function posChips(league, rows) {
  if (league === 'nba') {
    const have = new Set(rows.flatMap((r) => String(r.pos).split('-')));
    return ['All', ...['PG', 'SG', 'G', 'SF', 'PF', 'F', 'C'].filter((p) => have.has(p))];
  }
  const have = new Set(rows.map((r) => r.pos));
  return ['All', ...NFL_POS.filter((p) => have.has(p))];
}

/**
 * EVERYTHING THE BOARD NEEDS, from what the page read. PURE.
 * Signed out (`mine` null): no tag on any row, no My players chip, no tile.
 */
export function statsView({ league, games, stats, mine = null, signedIn = false }) {
  const supported = STATS_SPORTS.includes(league);
  if (!supported) {
    return { league, supported: false, soon: `Stats for ${SPORT_NAME[league] ?? league} coming soon`, rows: [], tiles: null, pos: [], showMine: false, anyLive: false, empty: null };
  }
  const rows = tagMine(shapeRows(league, games, stats), signedIn ? mine : null);
  return {
    league, supported: true, soon: null, rows,
    tiles: tilesOf(rows, { signedIn }),
    pos: posChips(league, rows),
    showMine: signedIn,
    anyLive: games.some((g) => g.status === 'live'),
    scoring: league === 'nba' ? 'ESPN pts' : 'PPR pts',
    empty: rows.length ? null : (games.length ? 'No player stats yet for this day. They appear once games start.' : `No ${SPORT_NAME[league]} games on this day.`),
  };
}
