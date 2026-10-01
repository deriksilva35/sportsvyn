// components/survivor/survivorRoom.test.mjs - the Survivor room mounted in
// jsdom (the weeklyRoomV2 method): the eighteen-week strip, the current week
// centred on load, a past week's result revealed IN PLACE on tap, and the CSS
// facts jsdom cannot see - one horizontal scroller, no vertical one anywhere.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
import { roomModel, pathCells, centerScrollLeft, weekDetail, NFL_REG_WEEKS } from '../../lib/survivor/view.js';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const STUB = stubPath(`__svv_actions_${process.pid}.mjs`);
const NAV = stubPath(`__svv_nav_${process.pid}.mjs`);
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '@/app/actions/survivor') return { url: pathToFileURL(STUB).href, shortCircuit: true };
  if (spec === 'next/navigation') return { url: pathToFileURL(NAV).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React; let createRoot; let act; let Room; let dom; let tmp;
const roots = new Set();
const CELL = 62; // 56 px + the 6 px gap

const pick = (week, abbr, result, o = {}) => ({
  week, team_id: abbr ? week * 10 : null, abbr, result, auto: false,
  home_team_id: week * 10, away_team_id: 999, home_abbr: abbr, away_abbr: 'OPP',
  home_score: 24, away_score: 17, kickoff_at: '2026-10-01T17:00:00Z', status: 'final', ...o,
});
// Entered week 5. Won 5, survived 6 (cancelled), missed 7 (two lives), current 8.
const PICKS = [
  pick(5, 'NYG', 'win'),
  pick(6, 'DAL', 'survive', { status: 'cancelled', home_score: null, away_score: null }),
  pick(7, null, 'missed'),
];
const ENTRY = { first_week: 5, lives_left: 1, eliminated_week: null };

before(async () => {
  writeFileSync(STUB, 'export const picks = []; export async function pickSurvivorTeam(...a) { picks.push(a); return { ok: true }; }');
  writeFileSync(NAV, 'export function useRouter() { return { push: () => {}, replace: () => {}, refresh: () => {} }; }');
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/survivor' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  // LAYOUT, which jsdom does not do: each cell at its week's offset, a 366 px
  // strip, and a scrollLeft that keeps what it is given.
  const P = dom.window.HTMLElement.prototype;
  Object.defineProperty(P, 'offsetLeft', { configurable: true, get() { const w = Number(this.dataset?.week); return Number.isFinite(w) ? (w - 1) * CELL : 0; } });
  Object.defineProperty(P, 'offsetWidth', { configurable: true, get() { return this.dataset?.week ? 56 : 366; } });
  Object.defineProperty(P, 'clientWidth', { configurable: true, get() { return 366; } });
  Object.defineProperty(P, 'scrollWidth', { configurable: true, get() { return NFL_REG_WEEKS * CELL - 6; } });
  Object.defineProperty(P, 'scrollLeft', { configurable: true, get() { return this.__sl ?? 0; }, set(v) { this.__sl = v; } });
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  const srcPath = path.join(__dirname, 'SurvivorRoom.js');
  const out = transformSync(readFileSync(srcPath, 'utf8'), {
    filename: srcPath, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false,
  }).code;
  tmp = stubPath(`__svv_room_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  Room = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { for (const f of [tmp, STUB, NAV]) { try { unlinkSync(f); } catch { /* gone */ } } });

function mount(week = 8, picks = PICKS, entry = ENTRY) {
  const model = roomModel({ rows: [], picks, entry, week, startWeek: entry?.first_week ?? week, now: new Date('2026-10-30T00:00:00Z') });
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(Room, { poolId: 1, week, model, lives: 2, livesLeft: 1 })));
  return c;
}

test('the strip draws all EIGHTEEN weeks, each in its state', () => {
  const c = mount();
  const cells = [...c.querySelectorAll('.svv-cell')];
  assert.equal(cells.length, 18);
  const st = Object.fromEntries(cells.map((x) => [x.dataset.week, x.dataset.state]));
  assert.deepEqual([st[1], st[4], st[5], st[6], st[7], st[8], st[9], st[18]],
    ['before', 'before', 'won', 'survive', 'missed', 'current', 'future', 'future']);
  const txt = (w) => c.querySelector(`.svv-cell[data-week="${w}"] .svv-tm`).textContent;
  assert.equal(txt(1), '—');
  assert.equal(txt(5), 'NYG ✓');
  assert.equal(txt(6), 'DAL –', 'a game not played: survived, team used');
  assert.equal(txt(7), 'MISSED ✗');
  assert.equal(txt(8), 'pick', 'the open week with no pick yet');
  assert.equal(txt(9), '');
});

test('the current week is CENTRED on load (the strip\'s own scrollLeft)', () => {
  const c = mount();
  const strip = c.querySelector('.svv-path');
  const want = centerScrollLeft({ cellLeft: 7 * CELL, cellWidth: 56, stripWidth: 366, scrollWidth: 18 * CELL - 6 });
  assert.equal(strip.scrollLeft, want);
  assert.equal(want, 7 * CELL - (366 - 56) / 2);
  // Week 1 and week 18 clamp to the ends.
  assert.equal(centerScrollLeft({ cellLeft: 0, cellWidth: 56, stripWidth: 366, scrollWidth: 1110 }), 0);
  assert.equal(centerScrollLeft({ cellLeft: 17 * CELL, cellWidth: 56, stripWidth: 366, scrollWidth: 1110 }), 1110 - 366);
});

test('tapping a past week shows its game IN PLACE; tapping again hides it; no navigation', () => {
  const c = mount();
  const line = () => c.querySelector('.svv-detail').textContent;
  assert.equal(line(), 'Tap a past week for its result');
  act(() => c.querySelector('.svv-cell[data-week="5"] button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.equal(line(), 'WK 5 · NYG 24 - 17 OPP · W');
  assert.equal(c.querySelector('.svv-cell[data-week="5"]').classList.contains('open'), true);
  act(() => c.querySelector('.svv-cell[data-week="7"] button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.equal(line(), 'WK 7 · no pick · MISSED');
  act(() => c.querySelector('.svv-cell[data-week="7"] button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.equal(line(), 'Tap a past week for its result');
  assert.equal(c.querySelector('.svv-cell[data-week="8"] button'), null, 'the current week is not a result to reveal');
  assert.equal(c.querySelector('.svv-cell[data-week="1"] button'), null);
  assert.equal(window.location.pathname, '/survivor');
});

test('lost is struck through, out is dimmed after elimination, the current pick shows its abbr', () => {
  const cells = pathCells({ picks: [pick(5, 'NYG', 'loss', { home_score: 17, away_score: 24 }), pick(6, 'BUF', 'pending', { status: 'scheduled' })], week: 6, firstWeek: 5, entry: { eliminated_week: null } });
  assert.deepEqual([cells[4].state, cells[4].label, cells[4].mark], ['lost', 'NYG', '✗']);
  assert.deepEqual([cells[5].state, cells[5].label], ['current', 'BUF']);
  assert.equal(weekDetail(pick(5, 'NYG', 'loss', { home_score: 17, away_score: 24 })), 'WK 5 · NYG 17 - 24 OPP · L');
  assert.equal(weekDetail(pick(5, 'NYG', 'loss', { home_score: 20, away_score: 20 })), 'WK 5 · NYG 20 - 20 OPP · T', 'a tie lost');
  const out = pathCells({ picks: [pick(5, 'NYG', 'loss')], week: 7, firstWeek: 5, entry: { eliminated_week: 5 } });
  assert.deepEqual(out.slice(4, 7).map((x) => x.state), ['lost', 'out', 'current']);
  const css = readFileSync(path.join(REPO, 'app/survivor/survivor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.svv-cell\.lost \.svv-tm, \.svv-cell\.missed \.svv-tm \{ text-decoration: line-through; \}/);
});

test('ONE horizontal scroller, snapping; NO vertical scroll container anywhere in the room', () => {
  const css = readFileSync(path.join(REPO, 'app/survivor/survivor.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /overflow-y:\s*(auto|scroll)/);
  assert.doesNotMatch(css, /overflow:\s*(auto|scroll)/);
  const xs = [...css.matchAll(/([^{}]+)\{([^{}]*overflow-x:\s*auto[^{}]*)\}/g)].map((m) => m[1].trim());
  assert.deepEqual(xs, ['.svv-path'], 'the strip is the only horizontal scroller');
  const strip = /\.svv-path \{([^}]*)\}/.exec(css)[1];
  assert.match(strip, /scroll-snap-type:\s*x mandatory/);
  assert.match(strip, /overflow-y:\s*hidden/);
  assert.match(css, /\.svv-cell \{[^}]*scroll-snap-align:\s*center/);
  const room = readFileSync(path.join(__dirname, 'SurvivorRoom.js'), 'utf8');
  assert.doesNotMatch(room, /scrollIntoView/, 'centring must not move the page');
});
