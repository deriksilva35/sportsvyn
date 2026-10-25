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
// fumble recovery 2, defensive TD 6) PLUS scoring.js's points-allowed tier, the
// points allowed being the OPPONENT'S SCORE read off the match row (a DST has no
// points-allowed column of its own). Yards allowed are not stored and the Weekly
// does not use them, so they are not scored.

import { fantasyPoints } from '../fantasy/scoring.js';
import { toStatLine, toDefenseLine } from '../fantasy/playerStats.js';
import { espnLinePoints } from '../nba/fantasyPoints.js';
import { nbaLiveLabel, nbaFinalLabel, finalPeriodOf } from '../nba/card.js';
import { shortOf, FOOTBALL } from '../live/vocabulary.js';
import { WEEKLY_FORMAT } from '../weekly/rules.js';
import { SLOTS } from '../daily/play.js';
import { nflWindow } from './nflWindow.js';
import { pairHasHeadgear } from '../teams/headgear.js';
import { TAB_COOKIE, TABS, wantTab, tabCookieString, STATUS_CYCLE, STATUS_WORDS, filterRows, tilesOf } from './statsFilter.js';

export { TAB_COOKIE, TABS, wantTab, tabCookieString, STATUS_CYCLE, STATUS_WORDS, filterRows, tilesOf };

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
const ALL_CHIPS = Object.freeze([['nfl', 'NFL'], ['cfb', 'CFB'], ['mlb', 'MLB'], ['nba', 'NBA'], ['epl', 'EPL']]);
/** The Stats tab's sport chips: ONLY the sports that are built. CFB / MLB / EPL appear here when each ships (add it to STATS_SPORTS). */
export const STATS_CHIPS = Object.freeze(ALL_CHIPS.filter(([k]) => STATS_SPORTS.includes(k)));
export const SPORT_NAME = Object.freeze({ nfl: 'NFL', cfb: 'CFB', mlb: 'MLB', nba: 'NBA', epl: 'EPL', ucl: 'UCL' });

/** The tab's sport: a BUILT sport the URL names, else NFL (?sport=cfb on Stats falls back to NFL; "all" has no board). */
export function statsSport(raw) {
  return STATS_SPORTS.includes(raw) ? raw : 'nfl';
}

export const REFRESH_MS = 30_000;
export const CACHE_SECONDS = 30;

// ---------------------------------------------------------------- the calculators

const num = (v) => Number(v ?? 0) || 0;

/** The position vocabulary the board prints: BDL's PK is K, the synthetic DEF is DST. */
export const nflPos = (p) => (p === 'PK' ? 'K' : p === 'DEF' ? 'DST' : p);

const isDst = (row) => row.position === 'DEF' || row.position === 'DST';

/**
 * Points for one NFL stat row (snake_case columns, as the table has them) under a
 * scoring.js format (default PPR). A D/ST row carries `pts_allowed` (the opponent's
 * score, set by shapeRows from the match) and gets the points-allowed tier with it.
 */
export function nflPoints(row, format = 'ppr') {
  if (isDst(row)) return fantasyPoints({ ...toDefenseLine(row), ptsAllowed: row.pts_allowed ?? null }, format);
  return fantasyPoints(toStatLine(row), format);
}

/** The Weekly's own scoring: its format word (rules.js WEEKLY_FORMAT), over the positions its pool holds. */
export const WEEKLY_SCORING = String(WEEKLY_FORMAT.scoring).toLowerCase();
export const WEEKLY_POS = Object.freeze(['QB', 'RB', 'WR', 'TE']
  .filter((p) => SLOTS.some((slot) => slot === p)));

/** Points under every scoring the row can have: the board re-scores in the browser from this. */
export function nflPointsBy(row) {
  const weekly = !isDst(row) && WEEKLY_POS.includes(nflPos(row.position)) ? nflPoints(row, WEEKLY_SCORING) : null;
  return { ppr: nflPoints(row, 'ppr'), half: nflPoints(row, 'half-ppr'), std: nflPoints(row, 'standard'), weekly };
}

/** ESPN points for one NBA stat row (the table's `turnovers` column spelling). */
export const nbaPoints = (row) => espnLinePoints(row);

const NFL_COLS = ['pass_cmp', 'pass_att', 'pass_yds', 'pass_td', 'pass_int', 'rush_att', 'rush_yds', 'rush_td',
  'tgt', 'rec', 'rec_yds', 'rec_td', 'fumbles_lost', 'fgm', 'fga', 'xp', 'sacks', 'def_int', 'fr', 'def_td'];

/** The raw stats the sort chips use (NFL): yards = pass + rush + receiving. */
export const nflSort = (r) => ({ yds: num(r.pass_yds) + num(r.rush_yds) + num(r.rec_yds), td: num(r.pass_td) + num(r.rush_td) + num(r.rec_td), tgt: num(r.tgt), att: num(r.rush_att) });
/** The raw stats the sort chips use (NBA). */
export const nbaSort = (r) => ({ pts: num(r.pts), reb: num(r.reb), ast: num(r.ast), tpm: num(r.fg3m), stocks: num(r.stl) + num(r.blk) });

/** Has this NFL row any recorded activity at all (a rostered man with an empty line has not played). */
export const nflPlayed = (row) => NFL_COLS.some((c) => num(row[c]) !== 0);

/** Has this NBA row a played line (a DNP, or no minutes and no counting stat, has not). */
export function nbaPlayed(row) {
  if (row.dnp) return false;
  if (num(row.seconds) > 0) return true;
  return ['pts', 'reb', 'ast', 'stl', 'blk', 'fga', 'fta', 'turnovers'].some((c) => num(row[c]) !== 0);
}

// ---------------------------------------------------------------- the stat lines

/**
 * The NFL stat line: short tokens joined by " · ". A TOKEN IS NEVER CUT - the board
 * lets the line wrap to a second line and keeps each token whole.
 *   QB   "24/33 · 312 yds · 3 TD · 1 INT · rush 5-41"
 *   RB   "rush 18-92 · rec 3-18 · 3/4 tgt · 2 TD"
 *   WR   "rec 7-118 · 7/9 tgt · 1 TD"     (rush att-yds, rec rec-yds, rec/targets)
 * `pa` (a D/ST's points allowed, the opponent's score) rides on the defense line.
 */
export function nflStatLine(row, pa = null) {
  const pos = nflPos(row.position);
  if (pos === 'DST') {
    const bits = [];
    if (pa != null) bits.push(`${pa} pts allowed`);
    const s = num(row.sacks);
    bits.push(`${s} sack${s === 1 ? '' : 's'}`);
    if (num(row.def_int)) bits.push(`${num(row.def_int)} INT`);
    if (num(row.fr)) bits.push(`${num(row.fr)} FR`);
    if (num(row.def_td)) bits.push(`${num(row.def_td)} TD`);
    return bits.join(' · ');
  }
  if (pos === 'K') return `${num(row.fgm)}/${num(row.fga)} FG · ${num(row.xp)} XP`;
  const rush = num(row.rush_att) || num(row.rush_yds) ? `rush ${num(row.rush_att)}-${num(row.rush_yds)}` : null;
  const rec = num(row.rec) || num(row.rec_yds) || num(row.tgt)
    ? [`rec ${num(row.rec)}-${num(row.rec_yds)}`, num(row.tgt) ? `${num(row.rec)}/${num(row.tgt)} tgt` : null].filter(Boolean) : [];
  const bits = [];
  if (pos === 'QB') {
    if (num(row.pass_att) || num(row.pass_cmp)) {
      bits.push(`${num(row.pass_cmp)}/${num(row.pass_att)}`, `${num(row.pass_yds)} yds`);
      if (num(row.pass_td)) bits.push(`${num(row.pass_td)} TD`);
      if (num(row.pass_int)) bits.push(`${num(row.pass_int)} INT`);
    }
    if (rush) bits.push(rush);
    if (num(row.rush_td)) bits.push(`${num(row.rush_td)} rush TD`);
  } else {
    const td = num(row.rush_td) + num(row.rec_td);
    if (pos === 'RB') { if (rush) bits.push(rush); bits.push(...rec); } else { bits.push(...rec); if (rush) bits.push(rush); }
    if (td) bits.push(`${td} TD`);
  }
  if (num(row.fumbles_lost)) bits.push(`${num(row.fumbles_lost)} FUM`);
  return bits.length ? bits.join(' · ') : '—';
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

/**
 * The LIVE pill's words: "Q4 · 3:12" (NFL), "Q3 · 6:02" (NBA); halftime reads "Half" in both
 * (Q2 at 0:00). The words come from lib/live/vocabulary.js shortOf - the one place a
 * period is named. A game the feed has marked final never reaches here: shapeRows
 * reads the MATCH status first, so a final game cannot show "Q4 · 0:00".
 */
export function liveWords(league, ls) {
  if (league === 'nba') return nbaLiveLabel(ls ?? {});
  const word = shortOf(ls ?? null, FOOTBALL);
  if (!word) return 'Live';
  if (word === 'HT') return 'Half';
  const c = ls?.clock == null || ls.clock === '' ? null : String(ls.clock);
  return c ? `${word} · ${c}` : word;
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
    // THE MATCH STATUS DECIDES THE PILL: live reads the live state, anything else is Final.
    const live = g.status === 'live';
    // A D/ST's points allowed is the OTHER side's score (the stat row has no such column).
    const pa = dst ? (home ? g.awayScore : g.homeScore) ?? null : null;
    const sr = dst ? { ...r, pts_allowed: pa } : r;
    const p = isNba ? { espn: nbaPoints(r) } : nflPointsBy(sr);
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
      line: isNba ? nbaStatLine(r) : nflStatLine(sr, pa),
      p,
      sv: isNba ? nbaSort(r) : nflSort(r),
      window: isNba ? null : nflWindow(g.kickoffAt),
      pts: isNba ? p.espn : p.ppr,
      c1: home ? g.homeC1 : g.awayC1, c2: home ? g.homeC2 : g.awayC2,
      headgear: pairHasHeadgear(league, g.awayAbbr, g.homeAbbr),
      inMine: false,
      mineSrc: [],
    });
  }
  out.sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
  return out.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Mark the viewer's players. Signed out (mine = null) leaves every row untagged. */
export function tagMine(rows, mine) {
  if (!mine) return rows;
  // `mine` is a Map key -> Set(source) (statsMine.js), or a plain Set of keys.
  return rows.map((r) => (mine.has(r.key) ? { ...r, inMine: true, mineSrc: [...(mine.get?.(r.key) ?? [])] } : r));
}

// ---------------------------------------------------------------- tiles and chips

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
export function statsView({ league, games, stats, mine = null, signedIn = false, total = null, firstKickoff = null, today = true }) {
  const supported = STATS_SPORTS.includes(league);
  if (!supported) {
    return { league, supported: false, soon: `Stats for ${SPORT_NAME[league] ?? league} coming soon`, rows: [], tiles: null, pos: [], showMine: false, anyLive: false, empty: null, firstTip: null };
  }
  const rows = tagMine(shapeRows(league, games, stats), signedIn ? mine : null);
  const slate = total ?? games.length;
  const empty = emptyState({ league, rows, games, slate, firstKickoff, today });
  return {
    league, supported: true, soon: null, rows,
    tiles: tilesOf(rows, { signedIn }),
    pos: posChips(league, rows),
    showMine: signedIn,
    anyLive: games.some((g) => g.status === 'live'),
    scoring: league === 'nba' ? 'ESPN pts' : 'PPR pts',
    empty: empty.text,
    firstTip: empty.firstTip,
  };
}

/** "First tip" (NBA) / "First kickoff" (NFL), and the day's count: "5 games tonight". PURE. */
export function firstTipWords(league, n) {
  const nba = league === 'nba';
  return { lead: nba ? 'First tip' : 'First kickoff', tail: `${n} game${n === 1 ? '' : 's'} ${nba ? 'tonight' : 'today'}` };
}

/**
 * THE EMPTY STATE. Rows -> none. Else:
 *   a slate that has not started   firstTip { lead, iso, tail }: "First tip <time> · 5 games tonight"
 *                                  (the time is the READER'S zone: the board prints iso through lib/time/display.js)
 *   a day with no games at all     "No NBA games today" (or "on this day" for another day)
 *   games running, no lines yet    "No player stats yet ..."
 */
export function emptyState({ league, rows, games, slate, firstKickoff, today = true }) {
  if (rows.length) return { text: null, firstTip: null };
  if (!slate) return { text: `No ${SPORT_NAME[league]} games ${today ? 'today' : 'on this day'}`, firstTip: null };
  if (!games.length && firstKickoff) return { text: null, firstTip: { ...firstTipWords(league, slate), iso: firstKickoff } };
  return { text: 'No player stats yet for this day. They appear once games start.', firstTip: null };
}
