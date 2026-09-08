// components/daily/season/seasonBoardClock.test.mjs - three minutes, on the
// server's clock, press-the-button style. Same harness as
// seasonBoardSubmit.test.mjs: the real component in jsdom, the real fetch.
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
let React, createRoot, act, SeasonBoard, dom, tmp;
let fetchCalls = []; let fetchImpl = null;
// EVERY ROOT IS TRACKED AND UNMOUNTED IN afterEach. The board screen runs a
// 1s setInterval; if an assertion fails before the test's own unmount, that
// interval keeps node alive and `node --test` never exits - which is exactly
// how the auto-submit mutation run hung for ten minutes. Never rely on a
// test reaching its last line to release a timer.
const liveRoots = new Set();

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'];
const TEAMS = Array.from({ length: 12 }, (_, i) => ({ key: `T${i}`, abbr: `T${i}`,
  card: [{ position: 'QB', name: `P${i}`, points: 10 + i, meta: '' }] }));
// FIVE OF EIGHT - what a partial board looks like when the clock runs out.
const PARTIAL = { slots: SLOTS.slice(), teams: TEAMS,
  roster: SLOTS.map((pos, i) => ({ pos, pick: i < 5 ? { teamKey: `T${i}`, player: { name: `P${i}`, points: 10 + i, position: 'QB', meta: '' } } : null })),
  used: ['T0', 'T1', 'T2', 'T3', 'T4'] };
const GRADE = { ok: true, glyph: '🟩🟩🟩🟩🟩⬛⬛⬛', mine: 60, pct: 30, perfect: 200, matchedCount: 5, slotCount: 8,
  pointsLeft: 140, bestRosterAbbrs: [], rows: [], untouchedTeams: [], biggestMissed: null };

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/daily/board' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = (...a) => { fetchCalls.push(a); return fetchImpl(...a); };
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react')); ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'SeasonBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), { filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false }).code;
  tmp = path.join(__dirname, `__clock_test_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  SeasonBoard = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of liveRoots) { try { act(() => r.unmount()); } catch { /* already gone */ } } liveRoots.clear(); });
after(() => { try { unlinkSync(tmp); } catch { /* gone */ } });

function render(elapsedS, extra = {}) {
  const container = document.getElementById('root');
  const root = createRoot(container); liveRoots.add(root);
  act(() => root.render(React.createElement(SeasonBoard, {
    edition: 'The Daily · 2097-01-01', year: '2015', teams: TEAMS, slots: SLOTS, ranked: true, userId: 1, boardId: 42,
    initialPlay: PARTIAL, initialScreen: 'board',
    initialStartedAt: new Date(Date.now() - elapsedS * 1000).toISOString(), ...extra,
  })));
  return { container, root };
}
const clock = (c) => c.querySelector('.sbd-clock');
const crumbFirst = (c) => { const root = c.querySelector('.sbd'); const first = root?.firstElementChild;
  return first?.querySelector('a.appcrumb[href="/games"]') ?? (first?.matches?.('a.appcrumb[href="/games"]') ? first : null); };

test('the clock counts DOWN from started_at: a reload at 2:10 elapsed shows 0:50', async () => {
  fetchCalls = []; fetchImpl = async () => { throw new Error('no submit expected'); };
  const { container, root } = render(130);
  await act(async () => {});
  assert.equal(clock(container).textContent, '0:50');
  assert.ok(!clock(container).className.includes('terra'), 'not terra with 50s left');
  assert.ok(crumbFirst(container), '← Games is the first child of the board screen');
  assert.equal(fetchCalls.length, 0);
  act(() => root.unmount());
});

test('under 0:30 the clock turns terra', async () => {
  fetchImpl = async () => { throw new Error('no submit expected'); };
  const { container, root } = render(160);
  await act(async () => {});
  assert.equal(clock(container).textContent, '0:20');
  assert.match(clock(container).className, /sbd-clock--terra/);
  act(() => root.unmount());
});

test('AT ZERO IT AUTO-SUBMITS THE PARTIAL ROSTER - no modal, once, and grades from the response', async () => {
  fetchCalls = [];
  fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, grade: GRADE, score: 60, pct: 0.3, matched: 5, elapsedS: 180 }) });
  const { container, root } = render(181);
  await act(async () => {}); await act(async () => {});
  assert.equal(fetchCalls.length, 1, 'exactly one POST, fired by the clock');
  const body = JSON.parse(fetchCalls[0][1].body);
  assert.equal(body.picks.length, 8, 'eight entries, always');
  assert.equal(body.picks.filter((p) => p.teamKey == null).length, 3, 'three empty slots sent as empty, not omitted');
  assert.match(container.textContent, /5 of 8 matched/, 'the grade screen rendered from the server');
  assert.ok(crumbFirst(container), '← Games is the first child of the grade screen');
  act(() => root.unmount());
});

test('a server "time expired" on auto-submit shows the DNF screen, not an error or a retry', async () => {
  fetchCalls = [];
  fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ error: 'time expired' }) });
  const { container, root } = render(190);
  await act(async () => {}); await act(async () => {});
  assert.equal(fetchCalls.length, 1);
  assert.match(container.textContent, /Ran out of clock/);
  assert.doesNotMatch(container.textContent, /try again/i);
  assert.ok(crumbFirst(container), '← Games is the first child of the DNF screen');
  act(() => root.unmount());
});

test('the receipt clock is capped at 3:00 - a 31-minute run reads 3:00', async () => {
  fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, grade: GRADE, score: 60, pct: 0.3, matched: 5, elapsedS: 1888 }) });
  fetchCalls = [];
  const { container, root } = render(181);
  await act(async () => {}); await act(async () => {});
  assert.match(container.textContent, /· 3:00/, 'elapsed shown as the round, not wall-clock');
  assert.doesNotMatch(container.textContent, /31:28/);
  act(() => root.unmount());
});

test('the rules card states the round and where the clock lives', () => {
  const container = document.getElementById('root'); const root = createRoot(container); liveRoots.add(root);
  act(() => root.render(React.createElement(SeasonBoard, { edition: 'e', year: '2015', teams: TEAMS, slots: SLOTS, ranked: true, userId: 1, boardId: 42 })));
  assert.match(container.textContent, /Three minutes from Start\. The clock is on the server\./);
  act(() => root.unmount());
});
