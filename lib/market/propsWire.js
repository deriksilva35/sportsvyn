// lib/market/propsWire.js - the props board ON THE WIRE (market-diet, sun-13).
// PURE: no database, so the browser imports it as well as the route.
//
// WHY. Static /market shipped every prop row inside the page: 3,169 rows,
// 2.43 MB of flight data, 96% of the HTML and of every RSC prefetch of it -
// and each hydrated load prefetched ~7 /market variants that all carried the
// same 2.5 MB. The default view (LINES) uses none of it. The rows now come
// from /api/market/props on demand, edge-cached, in this shape:
//
//   GAME-LEVEL FIELDS ONCE PER GAME. home, away, matchSlug, kickoffAt,
//     matchStatus, leagueSlug and onBoard were repeated on every row (~25
//     games, ~130 rows each). They live in `games`, keyed by matchId.
//   ROWS AS TUPLES. About 1 MB of the old payload was the same twenty JSON
//     keys written 3,169 times. A row is an array in ROW_COLS order.
//   LABELS ARE LOOKUPS. marketLabel, marketRowLabel and group are pure
//     functions of marketType (lib/market/propsShape.js tables).
//   THE CONTEXT SENTENCE IS DERIVED. contextLine needs the hit count, the
//     average, the season and the line - all on the row already.
//   NO CHART HISTORY. The ten-game chart is the Charts view's alone; it comes
//     from ?part=charts when that view opens. The index's five-bar spark rides
//     the row as five numbers.
//
// unpackProps(packProps(rows)) renders identically to rows (pinned by
// lib/market/propsWire.test.mjs against the real components).

import { MARKET_GROUPS, MARKET_LABELS, SCORER_SUFFIX } from './propsShape.js';
import { MARKET_STATS, lineFor, contextLine } from './propLine.js';
import { MARKET_LEAGUES } from './marketShape.js';

export const WIRE_VERSION = 1;

export const ROW_COLS = Object.freeze([
  'matchId', 'marketType', 'selection', 'side', 'line', 'american', 'impliedPct', 'asOffered',
  'moveProb', 'numBooks', 'playerId', 'playerSlug', 'position', 'teamAbbr',
  'hitCleared', 'hitGames', 'avg', 'season', 'spark',
]);
const COL = Object.fromEntries(ROW_COLS.map((c, i) => [c, i]));

/** One row's identity - the key every props view already renders it under. */
export const rowKey = (r) => `${r.matchId}|${r.marketType}|${r.selection}|${r.side ?? ''}`;

const GROUP_OF = new Map();
for (const g of MARKET_GROUPS) for (const m of g.markets) GROUP_OF.set(m, g.key);

const iso = (d) => (d == null ? null : new Date(d).toISOString());
// avg is games-over-a-season arithmetic (k/n, n <= 38): six decimals keeps
// every distinct value distinct and every toFixed(1) identical.
const round6 = (v) => (v == null ? null : Math.round(Number(v) * 1e6) / 1e6);
const team = (t) => ({ abbr: t?.abbr ?? null, name: t?.name ?? null });

/** propsBoardRows() output -> the wire. */
export function packProps(rows) {
  const games = {};
  const out = [];
  for (const r of rows ?? []) {
    if (!games[r.matchId]) {
      games[r.matchId] = {
        matchSlug: r.matchSlug ?? null, leagueSlug: r.leagueSlug ?? null,
        kickoffAt: iso(r.kickoffAt), matchStatus: r.matchStatus ?? null,
        home: team(r.home), away: team(r.away), onBoard: !!r.onBoard,
      };
    }
    const spark = r.chart?.points?.length ? r.chart.points.slice(-5).map((p) => p.value) : null;
    out.push([
      r.matchId, r.marketType, r.selection, r.side ?? null, r.line ?? null, r.american ?? null,
      r.impliedPct ?? null, r.asOffered ? 1 : 0, r.moveProb ?? null, r.numBooks ?? null,
      r.playerId ?? null, r.playerSlug ?? null, r.position ?? null, r.teamAbbr ?? null,
      r.hit ? r.hit.cleared : null, r.hit ? r.hit.games : null, round6(r.avg),
      r.hit ? (r.season ?? r.chart?.season ?? null) : null, spark,
    ]);
  }
  return { v: WIRE_VERSION, cols: ROW_COLS, games, rows: out };
}

/** The wire -> the rows every props component reads, minus the ten-game chart. */
export function unpackProps(payload) {
  if (!payload || payload.v !== WIRE_VERSION || !Array.isArray(payload.rows)) return [];
  const games = payload.games ?? {};
  return payload.rows.map((t) => {
    const g = games[t[COL.matchId]] ?? {};
    const marketType = t[COL.marketType];
    const hit = t[COL.hitCleared] == null ? null : { cleared: t[COL.hitCleared], games: t[COL.hitGames] };
    const avg = t[COL.avg];
    const season = t[COL.season];
    const spec = MARKET_STATS[marketType];
    const line = t[COL.line];
    return {
      matchId: t[COL.matchId],
      matchSlug: g.matchSlug ?? null,
      leagueSlug: g.leagueSlug ?? null,
      marketType,
      marketLabel: MARKET_LABELS[marketType] ?? marketType,
      group: GROUP_OF.get(marketType) ?? null,
      selection: t[COL.selection],
      side: t[COL.side],
      line,
      american: t[COL.american],
      impliedPct: t[COL.impliedPct],
      asOffered: t[COL.asOffered] === 1,
      moveProb: t[COL.moveProb],
      numBooks: t[COL.numBooks],
      kickoffAt: g.kickoffAt ?? null,
      matchStatus: g.matchStatus ?? null,
      home: g.home ?? { abbr: null, name: null },
      away: g.away ?? { abbr: null, name: null },
      onBoard: !!g.onBoard,
      playerId: t[COL.playerId],
      marketRowLabel: SCORER_SUFFIX[marketType]
        ? `Scorer - ${SCORER_SUFFIX[marketType]}`
        : (MARKET_LABELS[marketType] ?? marketType),
      playerSlug: t[COL.playerSlug],
      position: t[COL.position],
      teamAbbr: t[COL.teamAbbr],
      hit,
      avg,
      season,
      // THE SENTENCE, rebuilt from what the row carries - the same hr the
      // server's hitRate produced, field for field.
      context: hit && spec ? contextLine({
        season, games: hit.games, cleared: hit.cleared, perGame: avg,
        line: lineFor(marketType, line), noun: spec.noun, yesNo: spec.yesNo === true, event: spec.event ?? null,
      }) : null,
      spark: t[COL.spark],
      chart: null,
    };
  });
}

/** propsBoardRows() output -> the Charts view's history, keyed by rowKey. */
export function packCharts(rows) {
  const charts = [];
  for (const r of rows ?? []) {
    if (!r.chart?.points?.length) continue;
    charts.push([rowKey(r), r.chart.points.map((p) => [p.value, p.week ?? null, p.opponent ?? null])]);
  }
  return { v: WIRE_VERSION, charts };
}

/** The charts wire -> Map(rowKey -> [[value, week, opponent]]). */
export function unpackCharts(payload) {
  if (!payload || payload.v !== WIRE_VERSION || !Array.isArray(payload.charts)) return new Map();
  return new Map(payload.charts);
}

/**
 * Rows + charts -> rows wearing the chart chartSeries() built. line, season
 * and noun are the row's own (hr.line, hr.season, the market's noun), so only
 * the points travel.
 */
export function withCharts(rows, charts) {
  if (!charts?.size) return rows;
  return rows.map((r) => {
    const pts = charts.get(rowKey(r));
    if (!pts) return r;
    return {
      ...r,
      chart: {
        points: pts.map(([value, week, opponent]) => ({ value, week, opponent })),
        line: lineFor(r.marketType, r.line), season: r.season ?? null, noun: MARKET_STATS[r.marketType]?.noun,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// THE ENDPOINT'S URL GRAMMAR - one canonical form per answer, so the edge
// cache holds a handful of keys and a crawler cannot mint new ones.
//   /api/market/props?f=<all|nfl|cfb|epl>[&part=charts]
//   /api/market/props?game=<priced match id>[&part=charts]
// Exactly one of f / game, nothing else, every value from an allowlist.
// ---------------------------------------------------------------------------

export const PROPS_ENDPOINT = '/api/market/props';
// One minute fresh at the edge - the same clock as the page and its reads -
// and five more served stale while one request refreshes it.
export const PROPS_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';
export const PROPS_LEAGUES = Object.freeze(['all', ...MARKET_LEAGUES]);
export const PROPS_PARTS = Object.freeze(['rows', 'charts']);
const ALLOWED = new Set(['f', 'game', 'part']);

/**
 * @param params   URLSearchParams
 * @param gameIds  the priced match ids (propsGames), as numbers; null checks
 *                 the shape only (the route does that before any read)
 * @returns { ok: true, f, game, part } | { ok: false, status, error }
 */
export function parsePropsQuery(params, gameIds = []) {
  const keys = [...params.keys()];
  if (keys.some((k) => !ALLOWED.has(k))) return { ok: false, status: 400, error: 'unknown parameter' };
  if (new Set(keys).size !== keys.length) return { ok: false, status: 400, error: 'repeated parameter' };
  const f = params.get('f');
  const game = params.get('game');
  const part = params.get('part') ?? 'rows';
  if (!PROPS_PARTS.includes(part) || params.get('part') === 'rows') {
    // 'rows' is the default and is never written, so it has one spelling.
    return { ok: false, status: 400, error: 'bad part' };
  }
  if ((f == null) === (game == null)) return { ok: false, status: 400, error: 'exactly one of f, game' };
  if (f != null) {
    if (!PROPS_LEAGUES.includes(f)) return { ok: false, status: 400, error: 'bad league' };
    return { ok: true, f, game: null, part };
  }
  if (!/^[1-9]\d{0,9}$/.test(game)) return { ok: false, status: 400, error: 'bad game' };
  const id = Number(game);
  if (gameIds != null && !gameIds.includes(id)) return { ok: false, status: 404, error: 'no priced props for that game' };
  return { ok: true, f: null, game: id, part };
}

/** The canonical endpoint URL for a board state - the only one the client asks for. */
export function propsUrl({ league = 'all', game = null } = {}, part = 'rows') {
  const g = game == null || game === '' ? null : String(game);
  const base = g && /^[1-9]\d{0,9}$/.test(g)
    ? `${PROPS_ENDPOINT}?game=${g}`
    : `${PROPS_ENDPOINT}?f=${PROPS_LEAGUES.includes(league) ? league : 'all'}`;
  return part === 'charts' ? `${base}&part=charts` : base;
}
