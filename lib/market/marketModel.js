// lib/market/marketModel.js - everything /market shows, as a value. PURE.
//
// WHY THIS EXISTS (static /market). The page was rendered per request because
// its tabs and filters are the URL, and at ~1,100 requests a minute that was a
// database-bound function per hit. The page is now force-static: the server
// renders the WHOLE data set once per 60 s (the in-process caches), and the
// browser applies the URL. This function is the part that moved - the URL
// parse, the league / movers / game narrowing, the props filter and the table
// sorts - and it is pure so the filter-parity test can pin it against the
// server filter it replaced.
//
// THE URL GRAMMAR IS UNCHANGED. Every parameter reads exactly as MarketView
// read it; every href still comes from lib/market/marketUrl.js (marketHref),
// which is still the only place a /market URL is made.

import { MARKET_LEAGUES, hasMovement } from './marketShape.js';
import { propsBoardFrom, MARKET_LABELS } from './propsShape.js';
import {
  flattenLines, flattenFutures, sortRows, linesGames,
  LINES_COLUMNS, FUTURES_COLUMNS, LINES_PAGE, FUTURES_PAGE,
} from './lineTables.js';

// No EPL chip: soccer is retired (tue-14).
export const CHIPS = [['all', 'All'], ['nfl', 'NFL'], ['cfb', 'CFB'], ['movers', 'Movers only']];
export const TABS = [['lines', 'Lines'], ['props', 'Props'], ['futures', 'Futures']];
export const DEFAULT_TAB = 'lines';

/** URLSearchParams (or a plain object) -> the { key: string } shape the page reads. */
export function spFrom(params) {
  if (!params) return {};
  if (typeof params.get === 'function' && typeof params.keys === 'function') {
    const out = {};
    for (const k of new Set(params.keys())) out[k] = params.get(k);
    return out;
  }
  return params;
}

/** The URL, parsed - the half of MarketView that never touched data. */
export function parseMarketUrl(sp = {}, pinned = null) {
  const raw = typeof sp.f === 'string' ? sp.f : 'all';
  // THE PIN DECIDES THE LEAGUE; the URL still decides everything else. 'movers'
  // is not a league, so a pinned board can still be narrowed to movers.
  const urlFilter = CHIPS.some(([k]) => k === raw) ? raw : 'all';
  const filter = pinned && urlFilter !== 'movers' ? pinned : urlFilter;
  const rawTab = typeof sp.tab === 'string' ? sp.tab : DEFAULT_TAB;
  const tab = TABS.some(([k]) => k === rawTab) ? rawTab : DEFAULT_TAB;

  // THE WHOLE URL STATE, IN ONE OBJECT. Every control builds its href from
  // this and changes only its own key, so nothing can be dropped by a helper
  // that did not know about it.
  const urlState = {
    tab,
    view: typeof sp.view === 'string' ? sp.view : null,
    f: typeof sp.f === 'string' ? sp.f : null,
    g: typeof sp.g === 'string' ? sp.g : null,
    game: typeof sp.game === 'string' && sp.game !== '' ? sp.game : null,
    sort: typeof sp.sort === 'string' ? sp.sort : null,
    dir: sp.dir === 'asc' || sp.dir === 'desc' ? sp.dir : null,
    q: typeof sp.q === 'string' ? sp.q : null,
    board: sp.board === '1' ? '1' : null,
    movers: sp.movers === '1' ? '1' : null,
    team: typeof sp.team === 'string' && sp.team !== 'all' ? sp.team : null,
    pos: typeof sp.pos === 'string' && sp.pos !== 'all' ? sp.pos : null,
    mkt: typeof sp.mkt === 'string' && sp.mkt !== 'all' ? sp.mkt : null,
    hit: typeof sp.hit === 'string' && sp.hit !== '0' ? sp.hit : null,
  };

  // TWO DEFAULTS, DELIBERATELY OPPOSITE: props leads with the index, lines
  // and futures with their cards; each tab's unmarked URL renders what it
  // always rendered.
  const view = tab === 'props'
    ? (sp.view === 'charts' ? 'charts' : sp.view === 'table' ? 'table' : 'index')
    : (sp.view === 'table' ? 'table' : 'cards');
  const boardState = {
    league: filter === 'movers' ? 'all' : filter,
    game: typeof sp.game === 'string' && sp.game !== '' ? sp.game : null,
    dir: sp.dir === 'asc' || sp.dir === 'desc' ? sp.dir : null,
    group: typeof sp.g === 'string' ? sp.g : 'all',
    sort: typeof sp.sort === 'string' ? sp.sort
      : (typeof sp.s === 'string' ? sp.s : (view === 'index' ? 'kickoff' : 'move')),
    q: typeof sp.q === 'string' ? sp.q : '',
    boardOnly: sp.board === '1',
    moversOnly: sp.movers === '1' || filter === 'movers',
    team: typeof sp.team === 'string' ? sp.team : 'all',
    pos: typeof sp.pos === 'string' ? sp.pos : 'all',
    marketType: typeof sp.mkt === 'string' ? sp.mkt : 'all',
    minHitPct: Number(sp.hit) || 0,
    // The index shows a slate, not a page of forty.
    limit: view === 'index' ? 400 : undefined,
  };
  return { filter, tab, view, urlState, boardState, sp };
}

/**
 * THE LEAGUE NARROWING THE DATABASE USED TO DO. propsBoardRows(league) put the
 * league in its WHERE; the static page reads every league once and narrows
 * here. Every other column of a row is computed per row, so the survivors are
 * the rows the per-league read returned.
 */
export function propsForLeague(allRows, league) {
  // "All" is every MARKET league, not every row: a league that left the board
  // (EPL, tue-14) must not ride in on the unnarrowed read.
  const rows = (allRows ?? []).filter((r) => MARKET_LEAGUES.includes(r.leagueSlug));
  return MARKET_LEAGUES.includes(league) ? rows.filter((r) => r.leagueSlug === league) : rows;
}

/**
 * @param data  { slate: [[league, cards]], futures, books: [[league, n]],
 *                snapAt, boardIds: number[], propsRows, propsGames }
 */
export function marketModel(data, sp = {}, pinned = null) {
  const { filter, tab, view, urlState, boardState } = parseMarketUrl(sp, pinned);
  const byLeague = new Map((data.slate ?? []).map(([k, cards]) => [k, [...cards]]));
  const boardIds = new Set(data.boardIds ?? []);
  const books = new Map(data.books ?? []);
  const futures = data.futures ?? [];

  const board = tab === 'props'
    ? propsBoardFrom(propsForLeague(data.propsRows, boardState.league), boardState) : null;
  const games = tab === 'props' ? (data.propsGames ?? []) : [];

  // BOARD GAMES FIRST, WITHIN CFB - the only editorial ordering on the page.
  const cfb = byLeague.get('cfb') ?? [];
  cfb.sort((a, b) => (boardIds.has(b.matchId) ? 1 : 0) - (boardIds.has(a.matchId) ? 1 : 0));

  const indexTeams = board
    ? [...new Set(board.rows.flatMap((r) => [r.home.abbr, r.away.abbr]).filter(Boolean))].sort()
    : [];
  const indexStats = board
    ? [...new Set(board.rows.map((r) => r.marketType))].sort()
      .map((m) => [m, (MARKET_LABELS[m] ?? m).toUpperCase()])
    : [];

  const leagues = MARKET_LEAGUES.filter((s) => filter === 'all' || filter === 'movers' || filter === s);
  const shown = new Map();
  for (const s of leagues) {
    const list = byLeague.get(s) ?? [];
    const moved = filter === 'movers' ? list.filter(hasMovement) : list;
    shown.set(s, boardState.game ? moved.filter((c) => c.matchId === Number(boardState.game)) : moved);
  }
  const total = [...shown.values()].reduce((a, l) => a + l.length, 0);
  const cardBands = boardState.game
    ? leagues.filter((s) => (shown.get(s) ?? []).length) : leagues;

  const lineGameOptions = tab === 'lines' ? linesGames(byLeague, { boardIds, leagues: MARKET_LEAGUES }) : [];
  const linesSort = typeof sp.sort === 'string' ? sp.sort : 'game';
  const futuresSort = typeof sp.sort === 'string' ? sp.sort : 'implied';
  const allLines = tab === 'lines' && view === 'table'
    ? flattenLines(byLeague, { boardIds, leagues, game: boardState.game }) : [];
  const linesRows = sortRows(allLines, LINES_COLUMNS, linesSort, boardState.dir, 'game').slice(0, LINES_PAGE);
  const allFutures = tab === 'futures' && view === 'table' ? flattenFutures(futures) : [];
  const futuresRows = sortRows(allFutures, FUTURES_COLUMNS, futuresSort, boardState.dir, 'implied').slice(0, FUTURES_PAGE);

  return {
    filter, tab, view, urlState, boardState, board, games, boardIds, books, futures,
    indexTeams, indexStats, shown, total, cardBands, lineGameOptions,
    linesSort, futuresSort, linesRows, linesTotal: allLines.length,
    futuresRows, futuresTotal: allFutures.length,
  };
}
