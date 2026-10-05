// lib/market/propsWire.test.mjs - market-diet (sun-13): the props board leaves
// the static page and travels on its own wire.
//
// FOUR CLAIMS, each against the real code:
//   1. THE PAGE IS LIGHT. marketData() - the object /market serialises into
//      its HTML and every RSC payload - carries no prop rows, and stays under
//      a pinned budget on a slate-sized fixture whose props alone are > 2 MB.
//   2. THE ROUTE IS NARROW. /api/market/props accepts one canonical spelling
//      per answer, refuses the rest before any read, and caches at the edge.
//   3. THE WIRE IS LOSSLESS. unpackProps(packProps(rows)) renders the same
//      table, index and charts as the rows themselves.
//   4. THE WIRE IS SMALL. Per game, a fraction of what the rows were.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../testing/nextResolve.mjs';
import { stubPath } from '../testing/stubDir.mjs';

install();
const READS = stubPath('__cached_reads_wire.mjs');
const LINK = stubPath('__l_wire.mjs');
const COMP = stubPath('__comp_wire.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '@/lib/market/cachedReads') return { url: pathToFileURL(READS).href, shortCircuit: true };
  // THE PAGE'S COMPONENTS ARE NOT UNDER TEST HERE - only marketData() is - and
  // the header's import tree is large enough to matter on this host, so the
  // page's own component imports resolve to an empty component.
  if (ctx.parentURL?.endsWith('/app/market/page.js') && spec.startsWith('@/components/')) {
    return { url: pathToFileURL(COMP).href, shortCircuit: true };
  }
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  // PropsFilters imports './GameFilter' bare, the way Next's bundler allows.
  if (/^\.\.?\//.test(spec) && !/\.([cm]?js|css)$/.test(spec) && ctx.parentURL?.includes('/components/')) return next(`${spec}.js`, ctx);
  return next(spec, ctx);
} });

// ---------------------------------------------------------------------------
// A SLATE-SIZED FIXTURE: 25 games, ~127 priced props each (3,175 rows - the
// investigation counted 3,169), ten-game charts on the linked rows. Shapes are
// propsBoardRows()'s, field for field.
// ---------------------------------------------------------------------------
const MARKETS = ['player_pass_yds', 'player_pass_tds', 'player_rush_yds', 'player_receptions',
  'player_reception_yds', 'player_anytime_td', 'player_1st_td'];
const EPL_MARKETS = ['player_goal_scorer_anytime', 'player_first_goal_scorer', 'player_shots',
  'player_shots_on_target', 'player_assists'];
const LABEL = {
  player_pass_yds: 'Pass yds', player_pass_tds: 'Pass TDs', player_rush_yds: 'Rush yds', player_receptions: 'Recs',
  player_reception_yds: 'Rec yds', player_anytime_td: 'Anytime TD', player_1st_td: 'First TD',
  player_goal_scorer_anytime: 'Scorer', player_first_goal_scorer: 'First scorer', player_shots: 'Shots',
  player_shots_on_target: 'Shots OT', player_assists: 'Assists',
};
const GROUP = {
  player_pass_yds: 'pass', player_pass_tds: 'pass', player_rush_yds: 'rush', player_receptions: 'rec',
  player_reception_yds: 'rec', player_anytime_td: 'td', player_1st_td: 'td', player_goal_scorer_anytime: 'scorer',
  player_first_goal_scorer: 'scorer', player_shots: 'shots', player_shots_on_target: 'shots', player_assists: 'assists',
};
const NOUN = {
  player_pass_yds: 'pass yds', player_pass_tds: 'pass TDs', player_rush_yds: 'rush yds', player_receptions: 'recs',
  player_reception_yds: 'rec yds', player_anytime_td: 'TDs', player_1st_td: 'TDs', player_goal_scorer_anytime: 'goals',
  player_first_goal_scorer: 'goals', player_shots: 'shots', player_shots_on_target: 'shots on target', player_assists: 'assists',
};
const YESNO = new Set(['player_anytime_td', 'player_1st_td', 'player_goal_scorer_anytime', 'player_first_goal_scorer']);
const NO_HIT = new Set(['player_first_goal_scorer']);
const KICK0 = Date.now() + 2 * 86400000;

function fixture(nGames = 25, perGame = 127) {
  const rows = [];
  const games = [];
  for (let g = 0; g < nGames; g += 1) {
    const epl = g >= 15;
    const matchId = 21000 + g;
    const home = epl ? { abbr: `H${g}`, name: `Home Football Club ${g}` } : { abbr: `H${g}`, name: `Home City Team ${g}` };
    const away = epl ? { abbr: `A${g}`, name: `Away Football Club ${g}` } : { abbr: `A${g}`, name: `Away City Team ${g}` };
    const kickoffAt = new Date(KICK0 + g * 3600000);
    const markets = epl ? EPL_MARKETS : MARKETS;
    games.push({ matchId, leagueSlug: epl ? 'epl' : 'nfl', onBoard: g % 7 === 0, selections: perGame,
      label: `${epl ? 'EPL' : 'NFL'} · ${away.abbr} at ${home.abbr}`, kickoffAt });
    for (let i = 0; i < perGame; i += 1) {
      const marketType = markets[i % markets.length];
      const yesNo = YESNO.has(marketType);
      const paired = !yesNo;
      const side = paired ? (i % 2 ? 'Under' : 'Over') : null;
      // One name per row, so rowKey is unique per game as (match, market,
      // selection_label) is in odds_markets.
      const selection = `Firstname${i} Surname-Longer${g}x${i}`;
      const linked = i % 9 !== 0;
      const line = yesNo ? null : String(((i * 7) % 250) + 0.5);
      const hasHit = linked && !NO_HIT.has(marketType);
      const season = epl ? null : 2026;
      const games_ = 3 + (i % 5);
      const cleared = i % (games_ + 1);
      const avg = (cleared * 13 + 7) / games_;
      const lineNum = line == null ? 0.5 : Number(line);
      const chart = hasHit ? {
        points: Array.from({ length: Math.min(games_, 10) }, (_, k) => ({ value: (k * 31 + i) % 300, week: k + 1, opponent: `O${(k + g) % 30}` })),
        line: lineNum, season, noun: NOUN[marketType],
      } : null;
      const context = hasHit
        ? (yesNo
          ? `${season == null ? '' : `${season}: `}${marketType.includes('goal') ? 'scored' : 'a TD'} in ${cleared} of ${games_} games`
          : `${season == null ? '' : `${season}: `}cleared ${lineNum} ${NOUN[marketType]} in ${cleared} of ${games_} · ${avg.toFixed(1)}/game`)
        : null;
      rows.push({
        matchId, matchSlug: `${epl ? 'epl' : 'nfl'}-2026-game-${away.abbr}-${home.abbr}-long-slug`, leagueSlug: epl ? 'epl' : 'nfl',
        marketType, marketLabel: LABEL[marketType], group: GROUP[marketType], selection, side, line,
        american: paired ? -110 - (i % 20) : 150 + i, impliedPct: paired ? 50 + (i % 10) / 10 : null, asOffered: !paired,
        moveProb: i % 3 ? (i % 11) / 10 - 0.5 : null, numBooks: 1 + (i % 6),
        kickoffAt, matchStatus: 'scheduled', home, away, onBoard: g % 7 === 0,
        playerId: linked ? 1000 + i : null,
        marketRowLabel: marketType === 'player_goal_scorer_anytime' ? 'Scorer - anytime'
          : marketType === 'player_first_goal_scorer' ? 'Scorer - first' : LABEL[marketType],
        playerSlug: linked ? `firstname-surname-${g}-${i}` : null, position: linked ? ['QB', 'RB', 'WR', 'TE', 'M'][i % 5] : null,
        teamAbbr: linked ? (i % 2 ? home.abbr : away.abbr) : null,
        hit: hasHit ? { cleared, games: games_ } : null, avg: hasHit ? avg : null, season: hasHit ? season : null,
        context, chart,
      });
    }
  }
  return { rows, games };
}
const FIX = fixture();

let reads;
before(() => {
  writeFileSync(COMP, 'export default function Stub() { return null; }\n');
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, prefetch, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  writeFileSync(READS, `
    const S = globalThis.__wireReads;
    export const PROPS_MEMO_MS = 60000;
    export async function cachedPricedSlate() { S.calls.push('slate'); return new Map(S.slate); }
    export async function cachedFuturesBoards() { return S.futures; }
    export async function cachedBookCounts() { return new Map([['nfl', 7], ['cfb', 6], ['epl', 9]]); }
    export async function cachedLatestSnapshotAt() { return new Date('2026-10-04T12:00:00Z'); }
    export async function cachedBoardMatchIds() { return new Set([21000, 21007]); }
    export async function cachedPropsBoardRows(league = 'all') { S.calls.push('rows:' + league); return league === 'all' ? S.rows : S.rows.filter((r) => r.leagueSlug === league); }
    export async function cachedPropsBoard() { throw new Error('not used'); }
    export async function cachedPropsGames() { S.calls.push('games'); return S.games; }
  `);
  const card = (r) => ({
    leagueSlug: r.leagueSlug, matchId: r.matchId, matchSlug: r.matchSlug, matchStatus: 'scheduled', kickoffAt: r.kickoffAt, threeWay: r.leagueSlug === 'epl',
    away: { abbreviation: r.away.abbr, name: r.away.name }, home: { abbreviation: r.home.abbr, name: r.home.name },
    h2h: [{ label: r.away.name, american: 120, impliedPct: 45.1, moveProb: 0.3, value: null }, { label: r.home.name, american: -140, impliedPct: 54.9, moveProb: null, value: null }],
    spread: [{ label: r.home.name, american: -110, impliedPct: 50, moveProb: 0.1, value: '-2.5' }],
    total: [{ label: 'Over', american: -110, impliedPct: 50, moveProb: null, value: '44.5' }, { label: 'Under', american: -110, impliedPct: 50, moveProb: null, value: '44.5' }],
  });
  const firsts = FIX.games.map((g) => FIX.rows.find((r) => r.matchId === g.matchId));
  reads = {
    calls: [], rows: FIX.rows, games: FIX.games,
    slate: [['nfl', firsts.filter((r) => r.leagueSlug === 'nfl').map(card)], ['cfb', []], ['epl', firsts.filter((r) => r.leagueSlug === 'epl').map(card)]],
    futures: [{ leagueSlug: 'nfl', priced: 32, top: [{ label: 'Kansas City Chiefs', american: 500, impliedPct: 16.2 }] }],
  };
  globalThis.__wireReads = reads;
});
after(() => { for (const f of [READS, LINK, COMP]) { try { unlinkSync(f); } catch { /* gone */ } } });

// ---------------------------------------------------------------------------
// 1. THE PAGE
// ---------------------------------------------------------------------------

// THE BUDGET. /market's flight data was 2.53 MB, 2.43 MB of it prop rows. On
// this fixture the rows alone are well over 2 MB, so a page that carried them
// again cannot pass; the slate, futures and game list sit far under it.
const PAGE_BUDGET = 400 * 1024;

test('THE PAGE CARRIES NO PROP ROWS, and its data fits the budget', async () => {
  const rowsBytes = Buffer.byteLength(JSON.stringify(FIX.rows));
  assert.ok(rowsBytes > 2 * 1024 * 1024, `the fixture's rows are slate-sized (${rowsBytes} B)`);
  const { marketData } = await import('../../app/market/page.js');
  reads.calls.length = 0;
  const data = await marketData();
  assert.ok(!('propsRows' in data), 'marketData() has no propsRows');
  assert.ok(!reads.calls.some((c) => c.startsWith('rows:')), 'and the page never reads them');
  const bytes = Buffer.byteLength(JSON.stringify(data));
  assert.ok(bytes < PAGE_BUDGET, `the page's data is ${bytes} B, budget ${PAGE_BUDGET} B`);
  assert.equal(data.propsGames.length, 25, 'the game dropdown is still on the page');
});

// ---------------------------------------------------------------------------
// 2. THE ROUTE
// ---------------------------------------------------------------------------

async function get(qs) {
  const { GET } = await import('../../app/api/market/props/route.js');
  const res = await GET(new Request(`https://sportsvyn.test/api/market/props${qs}`));
  return { status: res.status, cc: res.headers.get('cache-control'), body: await res.json() };
}

test('THE ROUTE: canonical queries answer, cached at the edge', async () => {
  const { unpackProps, unpackCharts } = await import('./propsWire.js');
  const all = await get('?f=all');
  assert.equal(all.status, 200);
  assert.equal(all.cc, 'public, s-maxage=60, stale-while-revalidate=300');
  assert.equal(unpackProps(all.body).length, FIX.rows.length);

  const nfl = await get('?f=nfl');
  assert.ok(unpackProps(nfl.body).every((r) => r.leagueSlug === 'nfl'));

  const one = await get('?game=21016');
  assert.equal(one.status, 200);
  assert.equal(one.cc, 'public, s-maxage=60, stale-while-revalidate=300');
  const oneRows = unpackProps(one.body);
  assert.equal(oneRows.length, 127);
  assert.ok(oneRows.every((r) => r.matchId === 21016), 'one game, and only that game');

  const ch = await get('?game=21016&part=charts');
  assert.equal(ch.status, 200);
  assert.ok(unpackCharts(ch.body).size > 0, 'the history comes on its own request');
  assert.ok(!('charts' in one.body) && one.body.rows.every((t) => t.length === 19), 'and never rides the rows');
});

test('THE ROUTE: everything else is refused, and a malformed query reads nothing', async () => {
  for (const qs of ['', '?f=NFL', '?f=mlb', '?f=all&game=21016', '?f=all&x=1', '?f=all&f=nfl', '?f=nfl&part=rows',
    '?f=nfl&part=chart', '?game=abc', '?game=0', '?game=021016', '?game=1e5', '?game=21016&sort=hit', '?_rsc=1&f=all']) {
    reads.calls.length = 0;
    const r = await get(qs);
    assert.equal(r.status, 400, `${qs} is refused`);
    assert.deepEqual(reads.calls, [], `${qs} reads nothing`);
    assert.match(r.cc, /public, s-maxage=\d+/, 'and the refusal is cacheable');
  }
  reads.calls.length = 0;
  const unpriced = await get('?game=99999');
  assert.equal(unpriced.status, 404, 'a well-formed game with no priced props is a 404');
  assert.deepEqual(reads.calls, ['games'], 'which costs the cached game list, not the rows');
});

// ---------------------------------------------------------------------------
// 3. LOSSLESS - against the real components
// ---------------------------------------------------------------------------

async function renderHtml(Component, props) {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  return renderToStaticMarkup(React.createElement(Component, props));
}

test('THE WIRE ROUND-TRIPS: table, index and charts render byte-identical from the wire', async () => {
  const { packProps, unpackProps, packCharts, unpackCharts, withCharts } = await import('./propsWire.js');
  const { propsBoardFrom } = await import('./propsShape.js');
  // Through JSON, as the browser receives it.
  const wire = JSON.parse(JSON.stringify(packProps(FIX.rows)));
  const charts = unpackCharts(JSON.parse(JSON.stringify(packCharts(FIX.rows))));
  const back = unpackProps(wire);
  const full = withCharts(back, charts);
  // The server's rows, as the old page shipped them (Dates became strings).
  const orig = JSON.parse(JSON.stringify(FIX.rows));

  for (const k of ['context', 'marketLabel', 'marketRowLabel', 'group', 'home', 'away', 'kickoffAt', 'matchSlug', 'leagueSlug', 'onBoard', 'hit']) {
    // Row by row, so a failure prints one row rather than diffing 3,000.
    back.forEach((r, i) => assert.deepEqual(r[k], orig[i][k], `${k} survives the wire (row ${i})`));
  }
  // avg travels at six decimals (k/n arithmetic: every distinct value stays
  // distinct and every printed toFixed(1) is unchanged - the renders below).
  back.forEach((r, i) => assert.ok(r.avg === orig[i].avg || Math.abs(r.avg - orig[i].avg) < 1e-6, `avg row ${i}`));
  full.forEach((r, i) => assert.deepEqual(r.chart, orig[i].chart, `chart rebuilds exactly (row ${i})`));

  const PropsTable = (await import('../../components/market/PropsTable.js')).default;
  const PropsIndex = (await import('../../components/market/PropsIndex.js')).default;
  const PropsBoard = (await import('../../components/market/PropsBoard.js')).default;
  const hrefFor = () => '/market?tab=props';
  for (const state of [{ sort: 'move' }, { sort: 'hit', dir: 'desc' }, { sort: 'avg' }, { group: 'scorer' }, { game: 21003 }]) {
    const a = propsBoardFrom(orig, state);
    const b = propsBoardFrom(back, state);
    const c = propsBoardFrom(full, state);
    assert.equal(
      await renderHtml(PropsTable, { rows: b.rows, total: b.total, sort: state.sort, dir: state.dir, hrefFor }),
      await renderHtml(PropsTable, { rows: a.rows, total: a.total, sort: state.sort, dir: state.dir, hrefFor }),
      `table ${JSON.stringify(state)}`);
    assert.equal(
      await renderHtml(PropsBoard, { rows: c.rows, total: c.total, state, hrefFor, chromeless: true }),
      await renderHtml(PropsBoard, { rows: a.rows, total: a.total, state, hrefFor, chromeless: true }),
      `charts ${JSON.stringify(state)}`);
  }
  const ix = { league: 'all', team: 'all', pos: 'all', marketType: 'all', minHitPct: 0, sort: 'kickoff', limit: 400 };
  const a = propsBoardFrom(orig, ix);
  const b = propsBoardFrom(back, ix);
  const props = (rows) => ({ rows, filtered: rows.length, state: ix, hrefFor, teams: [], stats: [],
    cardHref: (r) => (r.playerSlug ? `/market/props/${r.playerSlug}?match=${r.matchId}` : null) });
  const html = await renderHtml(PropsIndex, props(b.rows));
  assert.equal(html, await renderHtml(PropsIndex, props(a.rows)), 'index');
  assert.match(html, /px-spark"/, 'and the index still draws its sparks');
});

// ---------------------------------------------------------------------------
// 4. SMALL
// ---------------------------------------------------------------------------

test('THE WIRE IS SMALL: one game\'s rows a fraction of what they were', async () => {
  const { packProps, packCharts } = await import('./propsWire.js');
  const game = FIX.rows.filter((r) => r.matchId === 21002);
  const before_ = Buffer.byteLength(JSON.stringify(game));
  const rows = Buffer.byteLength(JSON.stringify(packProps(game)));
  const charts = Buffer.byteLength(JSON.stringify(packCharts(game)));
  assert.ok(rows < before_ * 0.4, `rows ${rows} B vs ${before_} B before`);
  assert.ok(rows < 40 * 1024, `one game's rows under 40 KB (${rows} B)`);
  assert.ok(charts < before_ * 0.25, `charts ${charts} B, fetched only for the Charts view`);
});
