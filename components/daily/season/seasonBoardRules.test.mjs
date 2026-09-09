// components/daily/season/seasonBoardRules.test.mjs - the rules card has ONE
// tappable, it starts the clock, and it says so. Press-the-button harness.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { install } from '../../../lib/testing/nextResolve.mjs';
install();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let React, createRoot, act, SeasonBoard, dom, tmp; const roots = new Set();
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'];
const TEAMS = Array.from({ length: 12 }, (_, i) => ({ key: `T${i}`, abbr: `T${i}`, card: [{ position: 'QB', name: `P${i}`, points: 10, meta: '' }] }));
before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/daily/board' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async () => { throw new Error('no fetch on the rules card'); };
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react')); ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'SeasonBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), { filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false }).code;
  tmp = path.join(__dirname, `__rules_test_${process.pid}.mjs`); writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  SeasonBoard = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { try { unlinkSync(tmp); } catch { /* gone */ } });
function render(props) {
  const c = document.getElementById('root'); const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(SeasonBoard, { edition: 'The Daily · No. 025', year: '2021', teams: TEAMS, slots: SLOTS, ranked: true, userId: 1, boardId: 3, ...props })));
  return c;
}
test("signed in: the card's ONE tappable is the volt button 'Start the 3:00 clock'", () => {
  const c = render({});
  const card = c.querySelector('.sbd-rules') ?? c;
  const tappables = [...card.querySelectorAll('button, a, input, [role="button"]')];
  assert.equal(tappables.length, 1, `one tappable on the card, found ${tappables.length}`);
  const b = tappables[0];
  assert.equal(b.tagName, 'BUTTON'); assert.equal(b.textContent.trim(), 'Start the 3:00 clock');
  assert.match(b.className, /sbd-btn/, 'the volt button class');
  // The crumb is OUTSIDE the card - a sibling above it, never on it.
  assert.ok(c.querySelector('a.appcrumb'), 'the way out exists'); assert.ok(!card.contains(c.querySelector('a.appcrumb')));
});
test('signed out: the one tappable is the sign-in link, and it says so', () => {
  const c = render({ userId: null, signInHref: '/signin?next=%2Fdaily%2Fboard' });
  const card = c.querySelector('.sbd-rules') ?? c;
  const t = [...card.querySelectorAll('button, a, input')];
  assert.equal(t.length, 1); assert.equal(t[0].tagName, 'A'); assert.match(t[0].textContent, /Sign in to play/);
  assert.doesNotMatch(card.textContent, /Start the 3:00 clock/);
});
