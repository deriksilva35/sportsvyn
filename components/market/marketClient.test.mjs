// components/market/marketClient.test.mjs - static /market, PRESSED.
//
// The board filters in the browser now, so the thing to prove is the loop a
// reader actually runs: tap a chip, the URL changes, the rows change.
//
// SINCE market-diet THE CHIP IS NOT A NAVIGATION. A same-path click is caught
// on the board's root and becomes window.history.pushState - no router, no RSC
// request. So the stand-in Link here RECORDS any router navigation (there must
// be none), useSearchParams reads the real JSDOM location, and pushState is
// wrapped to re-render the way Next's history integration does. The chip, its
// href and the board that re-derives from the new URL are the real components.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';

install();
const L = stubPath('__l_mkc.mjs');
const N = stubPath('__n_mkc.mjs');
const C = stubPath('__c_mkc.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(L).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(N).href, shortCircuit: true };
  if (spec.endsWith('.css')) return { url: pathToFileURL(C).href, shortCircuit: true };
  // PropsFilters imports './GameFilter' bare, the way Next's bundler allows.
  if (/^\.\.?\//.test(spec) && !/\.[cm]?js$/.test(spec)) return next(`${spec}.js`, ctx);
  return next(spec, ctx);
} });

let React; let act; let createRoot; let MarketClient; let root; let host; let packProps; let packCharts;

const rerender = () => root.render(React.createElement(MarketClient, globalThis.__mkProps));
// A ROUTER NAVIGATION is what a Link click would have been. Recorded, never
// expected: every chip on this page is same-path.
function routerNavigate(href) { globalThis.__mkRouterNavs.push(String(href)); }

before(async () => {
  // The stand-in Link records its prefetch prop: a self-link that would
  // prefetch is the 2.5 MB amplifier this branch removed.
  writeFileSync(L, "import React from 'react'; export default function Link({ href, children, prefetch, ...rest }) { globalThis.__mkLinks.push({ href: String(href), prefetch }); return React.createElement('a', { ...rest, href: String(href), onClick: (e) => { e.preventDefault(); globalThis.__mkNavigate(String(href)); } }, children); }\n");
  writeFileSync(N, "export function useSearchParams(){ return new URLSearchParams(window.location.search); } export function usePathname(){ return window.location.pathname; } export function useRouter(){ return { push(){}, refresh(){} }; }\n");
  writeFileSync(C, 'export default {};\n');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/market' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.MutationObserver = dom.window.MutationObserver;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  MarketClient = (await import('./MarketClient.js')).default;
  globalThis.__mkNavigate = routerNavigate;
  globalThis.__mkLinks = [];
  ({ packProps, packCharts } = await import('../../lib/market/propsWire.js'));
  // NEXT'S HISTORY INTEGRATION, stood in: a pushState re-renders with the new
  // search params, and is recorded.
  const push = dom.window.history.pushState.bind(dom.window.history);
  dom.window.history.pushState = (st, t, url) => {
    push(st, t, url);
    globalThis.__mkNavs.push(String(url));
    act(() => rerender());
  };
});
after(() => {
  try { act(() => root?.unmount()); } catch { /* gone */ }
  for (const f of [L, N, C]) { try { unlinkSync(f); } catch { /* gone */ } }
});

const sel = (label, moveProb = null) => ({ label, american: -110, impliedPct: 50, moveProb, value: null });
const card = (leagueSlug, matchId, away, home, move = null) => ({
  leagueSlug, matchId, matchStatus: 'scheduled', kickoffAt: '2026-10-04T17:00:00.000Z', threeWay: false,
  away: { abbreviation: away }, home: { abbreviation: home },
  h2h: [sel(away, move), sel(home)], spread: [], total: [],
});
const DATA = {
  slate: [
    ['cfb', [card('cfb', 21, 'UGA', 'BAMA')]],
    ['nfl', [card('nfl', 11, 'KC', 'BUF', 0.02), card('nfl', 12, 'DAL', 'PHI')]],
    ['epl', [card('epl', 31, 'ARS', 'CHE')]],
  ],
  futures: [], books: [], snapAt: null, boardIds: [], propsRows: [], propsGames: [],
};
const matches = () => [...host.querySelectorAll('.g .match')].map((m) => m.textContent.trim());
const chip = (label) => [...host.querySelectorAll('.chips a')].find((a) => a.textContent === label);
const click = (el) => act(() => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })));
const flush = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

test('PRESS NFL: the URL takes ?f=nfl and the board drops every other league', () => {
  window.history.replaceState(null, '', '/market');
  globalThis.__mkNavs = [];
  globalThis.__mkRouterNavs = [];
  globalThis.__mkProps = { data: DATA };
  host = document.getElementById('root');
  root = createRoot(host);
  act(() => rerender());
  // EPL is back on the board (thu-24).
  assert.deepEqual(matches(), ['UGA at BAMA', 'KC at BUF', 'DAL at PHI', 'ARS at CHE'], 'unfiltered: all three leagues');
  assert.equal(chip('All').className.includes('on'), true);

  click(chip('NFL'));
  assert.deepEqual(globalThis.__mkNavs, ['/market?f=nfl'], 'the chip pushed marketHref\'s URL');
  assert.equal(window.location.search, '?f=nfl', 'and the address bar says so');
  assert.deepEqual(matches(), ['KC at BUF', 'DAL at PHI']);
  assert.equal(chip('NFL').className.includes('on'), true, 'and the chip now reads as on');

  // A SECOND PRESS KEEPS NOTHING IT SHOULD NOT: movers replaces the league.
  click(chip('Movers only'));
  assert.equal(globalThis.__mkNavs.at(-1), '/market?f=movers');
  assert.deepEqual(matches(), ['KC at BUF'], 'only the card with a 24h move');
  assert.deepEqual(globalThis.__mkRouterNavs, [], 'NO ROUTER NAVIGATION - so no RSC request - on a filter click');
});

test('NO SELF-LINK PREFETCHES: every /market link on the board renders prefetch={false}', () => {
  const self = globalThis.__mkLinks.filter((l) => l.href.startsWith('/market'));
  assert.ok(self.length > 5, 'the board rendered its tabs and chips');
  assert.deepEqual(self.filter((l) => l.prefetch !== false), [], 'a prefetching self-link fetches a whole /market payload');
});

test('A MODIFIED CLICK IS LEFT ALONE: cmd-click still opens the link, no pushState', () => {
  const before = globalThis.__mkNavs.length;
  const a = chip('CFB');
  const ev = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, metaKey: true });
  act(() => a.dispatchEvent(ev));
  assert.equal(globalThis.__mkNavs.length, before, 'no history entry');
  assert.deepEqual(globalThis.__mkRouterNavs, ['/market?f=cfb'], 'the click reached Link untouched (Link itself leaves modified clicks to the browser)');
  globalThis.__mkRouterNavs = [];
});

// ---------------------------------------------------------------------------
// PROPS ON DEMAND
// ---------------------------------------------------------------------------

const KICK = new Date(Date.now() + 86400000).toISOString();
const prop = (o) => ({
  matchId: 11, matchSlug: 'kc-buf', leagueSlug: 'nfl', marketType: 'player_pass_yds', marketLabel: 'Pass yds',
  group: 'pass', selection: 'Pat Mahomes', side: 'Over', line: '249.5', american: -110, impliedPct: 52.4,
  asOffered: false, moveProb: 0.5, numBooks: 4, kickoffAt: KICK, matchStatus: 'scheduled',
  home: { abbr: 'BUF', name: 'Buffalo' }, away: { abbr: 'KC', name: 'Kansas City' }, onBoard: false,
  playerId: 9, marketRowLabel: 'Pass yds', playerSlug: 'pat-mahomes', position: 'QB', teamAbbr: 'KC',
  hit: { cleared: 2, games: 3 }, avg: 260, season: 2026, context: '2026: cleared 249.5 pass yds in 2 of 3 · 260.0/game',
  chart: { points: [{ value: 300, week: 3, opponent: 'DEN' }, { value: 220, week: 2, opponent: 'LV' }, { value: 260, week: 1, opponent: 'LAC' }], line: 249.5, season: 2026, noun: 'pass yds' },
  ...o,
});
const PROPS = [prop({}), prop({ matchId: 31, matchSlug: 'ars-che', leagueSlug: 'epl', marketType: 'player_shots', selection: 'Bukayo Saka',
  line: '1.5', home: { abbr: 'CHE', name: 'Chelsea' }, away: { abbr: 'ARS', name: 'Arsenal' }, playerSlug: 'bukayo-saka', teamAbbr: 'ARS',
  position: 'M', hit: null, avg: null, season: null, context: null, chart: null })];

test('PROPS FETCHES ITS ROWS: the static data carries none, the tab asks the endpoint, a game asks for one game', async () => {
  const asked = [];
  globalThis.fetch = async (url) => {
    asked.push(String(url));
    const u = new URL(String(url), 'https://sportsvyn.test');
    const game = u.searchParams.get('game');
    const rows = game ? PROPS.filter((r) => r.matchId === Number(game)) : PROPS;
    const body = u.searchParams.get('part') === 'charts' ? packCharts(rows) : packProps(rows);
    return { ok: true, status: 200, json: async () => body };
  };
  window.history.pushState(null, '', '/market?tab=props');
  assert.match(host.textContent, /Loading props/, 'a loading band while the rows are on their way, never "no props"');
  await flush();
  assert.deepEqual(asked, ['/api/market/props?f=all']);
  assert.equal(host.querySelectorAll('.px-row').length, 2, 'both rows on the index');
  assert.ok(host.querySelector('.px-spark i'), 'the spark rides the row, no chart history needed');

  window.history.pushState(null, '', '/market?tab=props&game=31');
  await flush();
  assert.equal(asked.at(-1), '/api/market/props?game=31', 'a selected game is its own cache key');
  assert.equal(host.querySelectorAll('.px-row').length, 1);

  window.history.pushState(null, '', '/market?tab=props&view=charts');
  await flush();
  assert.ok(asked.includes('/api/market/props?f=all&part=charts'), 'charts load only for the Charts view');
  assert.equal(host.querySelectorAll('.pb-chart').length, 1, 'the one row with history draws its chart');
  assert.match(host.textContent, /2026: cleared 249\.5 pass yds in 2 of 3 · 260\.0\/game/, 'context derived in the browser');
  assert.equal(asked.filter((u) => u === '/api/market/props?f=all').length, 1, 'rows are not refetched inside the minute');
  assert.deepEqual(globalThis.__mkRouterNavs, []);
});

test('NO SELF-LINK PREFETCHES ON PROPS EITHER: index, table and charts views', async () => {
  globalThis.__mkLinks = [];
  for (const u of ['/market?tab=props', '/market?tab=props&view=table', '/market?tab=props&view=charts', '/market?view=table', '/market?tab=futures&view=table']) {
    window.history.pushState(null, '', u);
    await flush();
  }
  const self = globalThis.__mkLinks.filter((l) => l.href.startsWith('/market'));
  assert.ok(self.some((l) => l.href.startsWith('/market/props/')), 'the index rendered its player-card links');
  assert.ok(self.some((l) => /sort=/.test(l.href)), 'and the tables their sort headers');
  assert.deepEqual([...new Set(self.filter((l) => l.prefetch !== false).map((l) => l.href))], []);
});
