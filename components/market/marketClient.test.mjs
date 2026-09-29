// components/market/marketClient.test.mjs - static /market, PRESSED.
//
// The board filters in the browser now, so the thing to prove is the loop a
// reader actually runs: tap a chip, the URL changes, the rows change. The
// router is a stand-in (Link here calls it instead of Next's app router, and
// useSearchParams reads what it last navigated to), but the chip, its href and
// the board that re-derives from the new URL are the real components.

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

let React; let act; let createRoot; let MarketClient; let root; let host;

// THE STAND-IN ROUTER: a Link click navigates by setting the params and
// re-rendering, which is what the app router's soft navigation amounts to for
// a static page - same document, new search params.
function navigate(href) {
  const u = new URL(href, 'https://sportsvyn.test');
  globalThis.__mkParams = u.searchParams;
  globalThis.__mkNavs.push(u.pathname + u.search);
  act(() => root.render(React.createElement(MarketClient, globalThis.__mkProps)));
}

before(async () => {
  writeFileSync(L, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href), onClick: (e) => { e.preventDefault(); globalThis.__mkNavigate(String(href)); } }, children); }\n");
  writeFileSync(N, "export function useSearchParams(){ return globalThis.__mkParams; } export function usePathname(){ return '/market'; } export function useRouter(){ return { push(){}, refresh(){} }; }\n");
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
  globalThis.__mkNavigate = navigate;
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

test('PRESS NFL: the URL takes ?f=nfl and the board drops every other league', () => {
  globalThis.__mkParams = new URLSearchParams('');
  globalThis.__mkNavs = [];
  globalThis.__mkProps = { data: DATA };
  host = document.getElementById('root');
  root = createRoot(host);
  act(() => root.render(React.createElement(MarketClient, globalThis.__mkProps)));
  // The fixture still carries an EPL card; the board draws no EPL band (tue-14).
  assert.deepEqual(matches(), ['UGA at BAMA', 'KC at BUF', 'DAL at PHI'], 'unfiltered: both leagues, no soccer');
  assert.equal(chip('All').className.includes('on'), true);

  act(() => chip('NFL').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  assert.deepEqual(globalThis.__mkNavs, ['/market?f=nfl'], 'the chip navigated through marketHref');
  assert.deepEqual(matches(), ['KC at BUF', 'DAL at PHI']);
  assert.equal(chip('NFL').className.includes('on'), true, 'and the chip now reads as on');

  // A SECOND PRESS KEEPS NOTHING IT SHOULD NOT: movers replaces the league.
  act(() => chip('Movers only').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
  assert.equal(globalThis.__mkNavs.at(-1), '/market?f=movers');
  assert.deepEqual(matches(), ['KC at BUF'], 'only the card with a 24h move');
});
