// components/shell/appTabBar.test.mjs - the bottom bar, PRESSED.
//
// lib/shell/appTabs.test.mjs asserts the DATA. This asserts what a reader in
// the container actually sees, because the bar is the only navigation inside
// it - there is no URL bar to escape with - and the whole reason that list
// lives in its own file is that a product once shipped unreachable with a
// green suite behind it. A tab that exists in an array and never renders is
// the same defect wearing a different hat.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { SHELL_COOKIE, SHELL_VALUE } from '../../lib/shell/constants.js';
import { APP_TABS } from '../../lib/shell/appTabs.js';

install();

// next/navigation is a Next runtime module with no standalone build to import,
// so the bar's one input - the pathname - is supplied by a stub. It is a data:
// URL rather than a file because a temp module written inside the repo is read
// by eslint mid-run, and one outside it cannot resolve anything.
const NAV_STUB = `data:text/javascript,${encodeURIComponent(`
  export const usePathname = () => globalThis.__TEST_PATHNAME__ ?? '/';
  export const useRouter = () => ({ push() {}, replace() {}, refresh() {} });
  export const useSearchParams = () => new URLSearchParams();
  export const redirect = () => {};
  export const notFound = () => {};
`)}`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'next/navigation') return { url: NAV_STUB, shortCircuit: true };
    return next(specifier, context);
  },
});

let React; let createRoot; let act; let AppTabBar; let dom;
const roots = new Set();

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'https://sportsvyn.test/games' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.MutationObserver = dom.window.MutationObserver;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  // THE BAR ONLY EXISTS INSIDE THE CONTAINER. Without the cookie it renders
  // null on purpose, which would make every assertion below vacuously true.
  dom.window.document.cookie = `${SHELL_COOKIE}=${SHELL_VALUE}`;
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  AppTabBar = (await import('./AppTabBar.js')).default;
});
afterEach(() => {
  for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } }
  roots.clear(); document.getElementById('root').innerHTML = '';
  document.documentElement.removeAttribute('data-tab');
});
after(() => { for (const r of roots) { try { r.unmount(); } catch { /* gone */ } } });

function bar(pathname) {
  globalThis.__TEST_PATHNAME__ = pathname;
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(AppTabBar)));
  return c;
}
const tabs = (c) => [...c.querySelectorAll('a.apptab-i')];
const txt = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const onKey = (c) => tabs(c).find((a) => a.className.includes(' on'))?.getAttribute('data-key') ?? null;

test('THE BAR RENDERS FIVE TABS, in order, each a real link', () => {
  const c = bar('/games');
  const list = tabs(c);
  assert.equal(list.length, 5, 'five tabs reach the DOM, not four and not an array of five');
  assert.deepEqual(list.map((a) => a.getAttribute('data-key')),
    ['games', 'scores', 'market', 'rankings', 'you']);
  assert.deepEqual(list.map((a) => txt(a.querySelector('.lb'))),
    ['Play', 'Scores', 'Market', 'Rankings', 'You']);
  // Every one is a link with an internal href - the bar is the only way out.
  for (const a of list) {
    assert.equal(a.tagName, 'A');
    assert.match(a.getAttribute('href'), /^\//, `${a.getAttribute('data-key')} must be internal`);
  }
  // And the rendered list is the declared list, so neither can drift alone.
  assert.deepEqual(list.map((a) => a.getAttribute('href')), APP_TABS.map((t) => t.href));
});

test('THE MARKET TAB SITS THIRD and opens the props view', () => {
  const c = bar('/games');
  const market = tabs(c)[2];
  assert.equal(market.getAttribute('data-key'), 'market');
  assert.equal(market.getAttribute('href'), '/market?tab=props');
  assert.equal(txt(market.querySelector('.ic')), '📈');
});

test('A LEAGUE MARKET PAGE LIGHTS MARKET, not Scores', () => {
  // /cfb/market starts with /cfb. Before the market test ran first, the league
  // branch swallowed it and lit SCORES on the very page the tab points at.
  const c = bar('/cfb/market?tab=props');
  assert.equal(onKey(c), 'market');
  const market = tabs(c)[2];
  assert.equal(market.getAttribute('aria-current'), 'page', 'and it says so to a screen reader');
  assert.equal(tabs(c).filter((a) => a.className.includes(' on')).length, 1, 'exactly one tab lights');
});

test('A PLAYER CARD LIGHTS MARKET', () => {
  const c = bar('/market/props/andrew-marsh-cfb-5141572?match=20862');
  assert.equal(onKey(c), 'market');
});

test('THE TABS THAT DID NOT MOVE STILL LIGHT', () => {
  assert.equal(onKey(bar('/scores')), 'scores');
  assert.equal(onKey(bar('/cfb')), 'scores', 'a league page is still a scoreboard surface');
  assert.equal(onKey(bar('/rankings')), 'rankings');
  assert.equal(onKey(bar('/games')), 'games');
  assert.equal(onKey(bar('/you')), 'you');
  // The front door lights nothing, and the bar still renders all five.
  const home = bar('/');
  assert.equal(onKey(home), null);
  assert.equal(tabs(home).length, 5);
});
