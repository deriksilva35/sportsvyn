// lib/scores/statsFilter.js - the browser-safe half of the Stats tab, PURE.
//
// The tab cookie (sv_scores_tab, the pattern of sv_top25), the FILTER STATE and
// the pipeline that turns the day's rows into the board's list. Kept apart from
// statsTab.js because client components import THIS file, and statsTab.js
// reaches the scorers and (through them) modules a browser bundle must not pull in.
//
// THE STATE LIVES IN THE URL. parseState reads ?sc= &sort= &st= &win= &q= &tg=
// &pos= &only= &min= (defaults are omitted, so the default board has a clean
// URL); toQuery writes it back. The server parses the same params the client
// writes, so a shared link renders the same list on the first paint.
//
// THE ROWS CARRY EVERY SCORING. A row has `p` (points under each scoring it can
// have) and `sv` (the raw stats a sort can use), so changing scoring, sort or any
// filter is a pure re-run of applyState in the browser - and "Show N players" on
// the sheet is the length of the list that run would give.

export const TAB_COOKIE = 'sv_scores_tab';
export const TABS = Object.freeze(['games', 'stats']);

/** The request's tab: the query when it names one, else the remembered value, else Games. */
export function wantTab(queryValue, cookieValue) {
  if (TABS.includes(queryValue)) return queryValue;
  return TABS.includes(cookieValue) ? cookieValue : 'games';
}

/** The Set-Cookie string document.cookie takes; a year, site-wide. */
export function tabCookieString(tab) {
  return `${TAB_COOKIE}=${tab === 'stats' ? 'stats' : 'games'}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

// ---------------------------------------------------------------- the options

/** The status chip cycles Live + final -> Live -> Final. */
export const STATUS_CYCLE = Object.freeze(['all', 'live', 'final']);
export const STATUS_WORDS = Object.freeze({ all: 'Live + final', live: 'Live', final: 'Final', pending: 'Not started' });
/** The sheet's status choices. Not started has no stats to list: the chip stays honest, the list says so. */
export const STATUS_OPTS = Object.freeze([['all', 'Live + final'], ['live', 'Live'], ['final', 'Final'], ['pending', 'Not started']]);

export const SCORING_OPTS = Object.freeze({
  nfl: Object.freeze([['ppr', 'PPR'], ['half', 'Half PPR'], ['std', 'Standard'], ['weekly', 'Sportsvyn Weekly'], ['raw', 'Raw stats']]),
  nba: Object.freeze([['espn', 'ESPN pts'], ['raw', 'Raw stats']]),
});
export const SCORING_WORDS = Object.freeze({ ppr: 'PPR pts', half: 'Half PPR pts', std: 'Standard pts', weekly: 'Weekly pts', espn: 'ESPN pts', raw: '' });

export const SORT_OPTS = Object.freeze({
  nfl: Object.freeze([['fp', 'Fantasy pts'], ['yds', 'Yards'], ['td', 'TDs'], ['tgt', 'Targets'], ['att', 'Rush att']]),
  nba: Object.freeze([['fp', 'Fantasy pts'], ['pts', 'PTS'], ['reb', 'REB'], ['ast', 'AST'], ['tpm', '3PM'], ['stocks', 'STL+BLK']]),
});

export const WINDOW_OPTS = Object.freeze([['all', 'All'], ['early', 'Early'], ['late', 'Late'], ['snf', 'SNF'], ['mnf', 'MNF']]);

/** The "Only" choices; the signed-out reader has none. NBA's Weekly is Tonight's Six. */
export function onlyOpts(league, signedIn) {
  if (!signedIn) return [];
  return league === 'nba'
    ? [['mine', 'In my games'], ['six', "Tonight's Six"], ['draft', 'My Draft team']]
    : [['mine', 'In my games'], ['weekly', 'My Weekly six'], ['draft', 'My Draft team'], ['league', 'My leagues']];
}

export const MIN_PTS_MAX = 40;

// ---------------------------------------------------------------- the state

const scoringDefault = (league) => (league === 'nba' ? 'espn' : 'ppr');

export function defaultState(league) {
  return { sc: scoringDefault(league), sort: 'fp', st: 'all', win: 'all', q: '', tg: '', pos: 'All', only: 'all', min: 0 };
}

const has = (opts, v) => opts.some(([k]) => k === v);
const one = (v) => (Array.isArray(v) ? v[0] : v);

/** The state a request's searchParams (an object, or URLSearchParams) describe. Anything unknown is the default. */
export function parseState(league, sp = {}) {
  const get = (k) => one(typeof sp.get === 'function' ? sp.get(k) : sp[k]);
  const d = defaultState(league);
  const lg = league === 'nba' ? 'nba' : 'nfl';
  const sc = get('sc');
  const out = { ...d };
  if (has(SCORING_OPTS[lg], sc)) out.sc = sc;
  const sort = get('sort');
  if (has(SORT_OPTS[lg], sort)) out.sort = sort;
  // Raw stats show no points, so a points sort has nothing to sort by: the first stat stands in.
  if (out.sc === 'raw' && out.sort === 'fp') out.sort = SORT_OPTS[lg][1][0];
  const st = get('st');
  if (has(STATUS_OPTS, st)) out.st = st;
  const win = get('win');
  if (lg === 'nfl' && has(WINDOW_OPTS, win)) out.win = win;
  out.q = String(get('q') ?? '').slice(0, 60);
  out.tg = String(get('tg') ?? '').slice(0, 60);
  const pos = get('pos');
  if (typeof pos === 'string' && /^[A-Z-]{1,3}$/.test(pos)) out.pos = pos;
  const only = get('only');
  if (['mine', 'weekly', 'draft', 'league', 'six'].includes(only)) out.only = only;
  const min = Number(get('min'));
  if (Number.isFinite(min) && min > 0) out.min = Math.min(MIN_PTS_MAX, Math.round(min));
  return out;
}

/** [key, value] pairs for every field that is not the default: the URL's query. */
export function toQuery(league, state) {
  const d = defaultState(league);
  const out = [];
  for (const k of ['sc', 'sort', 'st', 'win', 'q', 'tg', 'pos', 'only', 'min']) {
    const v = state[k];
    if (v !== d[k] && v !== '' && v !== undefined) out.push([k, String(v)]);
  }
  return out;
}

/** How many sheet filters are off their default (the "Filters · N" chip). The search box is not one. */
export function awayCount(league, state) {
  const d = defaultState(league);
  return ['sc', 'sort', 'st', 'win', 'tg', 'pos', 'only', 'min'].filter((k) => (state[k] ?? d[k]) !== d[k]).length;
}

// ---------------------------------------------------------------- the pipeline

/** Points under the state's scoring; null for Raw stats, and for a row the scoring has no number for. */
export function pointsOf(row, state) {
  if (state.sc === 'raw') return null;
  const v = row.p?.[state.sc];
  return v == null ? null : v;
}

/** The sort key's value for a row. */
function sortValue(row, state, pts) {
  if (state.sort === 'fp') return pts ?? -Infinity;
  return row.sv?.[state.sort] ?? 0;
}

const posMatches = (pos, rowPos) => pos === 'All' || String(rowPos).split('-').includes(pos) || rowPos === pos;

/**
 * Narrow the rows (pure, so a fixture can pin it). Search matches name, team or game
 * ("buf", "mia @ buf", "allen"); `tg` matches team or game only. Rank stays the day's
 * rank, not the row's place in the narrowed list. `mine` is the old boolean spelling of
 * only: 'mine'.
 */
export function filterRows(rows, { q = '', tg = '', pos = 'All', status, st, win = 'all', only = 'all', mine = false, min = 0 } = {}) {
  const needle = String(q).trim().toLowerCase();
  const game = String(tg).trim().toLowerCase();
  const stat = st ?? status ?? 'all';
  const onlyKind = mine && only === 'all' ? 'mine' : only;
  return rows.filter((r) => {
    if (!posMatches(pos, r.pos)) return false;
    if (stat === 'pending') return false;
    if (stat !== 'all' && r.status !== stat) return false;
    if (win !== 'all' && r.window !== win) return false;
    if (onlyKind === 'mine' && !r.inMine) return false;
    if (onlyKind !== 'all' && onlyKind !== 'mine' && !(r.mineSrc ?? []).includes(onlyKind)) return false;
    if (min > 0 && !((r.pts ?? -Infinity) >= min)) return false;
    const hay = `${r.team} ${r.opp} ${r.tag} ${r.opp} @ ${r.team}`.toLowerCase();
    if (game && !hay.includes(game)) return false;
    if (needle && !`${r.name} ${hay}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/**
 * THE BOARD'S LIST. Score every row under the state's scoring (a row the scoring
 * has no number for - a kicker under Sportsvyn Weekly - drops out, it is not a zero),
 * sort by the chosen key, rank, then narrow.
 *   rank     the overall place in the day's sorted list
 *   posRank  the place among the same position, set only while a position filter is on
 * @returns {{ all: object[], list: object[] }}  all = scored+sorted+ranked, list = narrowed
 */
export function applyState(rows, state) {
  const raw = state.sc === 'raw';
  const scored = [];
  for (const r of rows) {
    const pts = pointsOf(r, state);
    if (!raw && pts == null) continue;
    scored.push({ ...r, pts, _s: sortValue(r, state, pts) });
  }
  scored.sort((a, b) => b._s - a._s || a.name.localeCompare(b.name));
  const counts = new Map();
  const all = scored.map((r, i) => {
    const { _s, ...rest } = r;
    let posRank = null;
    if (state.pos !== 'All' && posMatches(state.pos, r.pos)) {
      const n = (counts.get(state.pos) ?? 0) + 1;
      counts.set(state.pos, n);
      posRank = n;
    }
    return { ...rest, rank: i + 1, posRank };
  });
  return { all, list: filterRows(all, state) };
}

// ---------------------------------------------------------------- tiles

const round1 = (x) => Math.round(x * 10) / 10;

/** The three tiles. `yours` is null signed out - the tile is not drawn at all. */
export function tilesOf(rows, { signedIn }) {
  const top = rows[0] ?? null;
  const byGame = new Map();
  for (const r of rows) {
    const g = byGame.get(r.gameId) ?? { tag: null, pts: 0, away: null, home: null };
    g.pts += r.pts ?? 0;
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
    yours: signedIn ? { count: mine.length, pts: round1(mine.reduce((a, r) => a + (r.pts ?? 0), 0)) } : null,
    biggest: big ? { tag: `${big.away ?? '?'} @ ${big.home ?? '?'}`, pts: round1(big.pts) } : null,
  };
}

