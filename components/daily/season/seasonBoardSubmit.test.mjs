// components/daily/season/seasonBoardSubmit.test.mjs - THE BUTTON, NOT THE
// MODULE.
//
// WHY THIS FILE EXISTS AND WHY IT LOOKS LIKE THIS. /api/daily/board/run had
// ZERO callers at every commit it had ever existed for. handleFinish cleared
// the clock, computed a grade in the browser and threw it away; picks stayed
// NULL forever, so today's board could be replayed from the lobby all day -
// and every existing test passed, because they all called submitRun() and
// startRun() directly. A module test cannot see a button that is not wired to
// it. So this one renders the real component into jsdom, clicks the real
// button, and asserts on the real fetch.
//
// The JSX is compiled with @babel/core (the same dependency
// lib/testing/renderJsx.mjs already uses) and the '@/...' and .css imports
// are resolved by lib/testing/nextResolve.mjs, registered below.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');

import { install } from '../../../lib/testing/nextResolve.mjs';
install();

let React, createRoot, act, SeasonBoard, dom, tmp;
let fetchCalls = [];
let fetchImpl = null;

// A 12-team board whose cards are trivial but well formed, and a play state
// with all eight slots already filled - the Finish button only renders on a
// complete roster, and filling it by clicking twelve sheets would be testing
// the sheet, not the submit.
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'];
const TEAMS = Array.from({ length: 12 }, (_, i) => ({
  key: `T${i}`, abbr: `T${i}`,
  card: [{ position: 'QB', name: `P${i}`, points: 10 + i, meta: '' }],
}));
const PLAY = {
  slots: SLOTS.slice(),
  teams: TEAMS,
  roster: SLOTS.map((pos, i) => ({
    pos, pick: { teamKey: `T${i}`, player: { name: `P${i}`, points: 10 + i, position: 'QB', meta: '' } },
  })),
  used: new Set(TEAMS.slice(0, 8).map((t) => t.key)),
};

// The shape the route returns on a 200 - a full grade, because the grade
// screen renders rows, the best roster and points-left, not three numbers.
const SERVER_GRADE = {
  ok: true, glyph: '🟩', mine: 123.4, pct: 61, perfect: 200,
  matchedCount: 3, slotCount: 8, pointsLeft: 76.6,
  bestRosterAbbrs: ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'],
  rows: [],
  // boardStory() reads these two off the grade - they are part of the shape
  // the server returns, not decoration, so the fixture carries them.
  untouchedTeams: ['T8', 'T9', 'T10', 'T11'],
  biggestMissed: { best: { name: 'P11', abbr: 'T11', points: 21 } },
};

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/daily/board' });
  global.window = dom.window;
  global.document = dom.window.document;
  // node 22 defines globalThis.navigator as a getter-only accessor, so a
  // plain assignment throws. defineProperty replaces the descriptor outright.
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator, configurable: true, writable: true,
  });
  global.HTMLElement = dom.window.HTMLElement;
  global.Event = dom.window.Event;
  global.MouseEvent = dom.window.MouseEvent;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  // next/link's client bundle references `self`. jsdom's window is the right
  // object for it, and nothing else in this tree touches it.
  global.self = dom.window;
  global.fetch = (...args) => { fetchCalls.push(args); return fetchImpl(...args); };

  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));

  // Compile the component's JSX to a sibling file so ordinary node_modules
  // resolution applies (the same reason renderJsx.mjs writes a real file).
  const src = path.join(__dirname, 'SeasonBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), {
    filename: src,
    presets: [['@babel/preset-react', { runtime: 'automatic' }]],
    plugins: [],
    configFile: false, babelrc: false,
  }).code;
  tmp = path.join(__dirname, `__submit_test_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  SeasonBoard = (await import(pathToFileURL(tmp).href)).default;
});

after(() => { try { unlinkSync(tmp); } catch { /* already gone */ } });

function renderBoard(props = {}) {
  const container = document.getElementById('root');
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(SeasonBoard, {
      edition: 'The Daily · 2097-01-01', year: '2015', teams: TEAMS, slots: SLOTS,
      ranked: true, userId: 1, boardId: 42,
      initialPlay: PLAY, initialScreen: 'board',
      initialStartedAt: new Date(Date.now() - 90_000).toISOString(),
      ...props,
    }));
  });
  return { container, root };
}

function clickFinish(container) {
  const btn = [...container.querySelectorAll('button')]
    .find((b) => /see your grade|submitting/i.test(b.textContent));
  assert.ok(btn, 'the Finish button is on screen for a complete roster');
  return btn;
}

test('clicking Finish POSTs to /api/daily/board/run with boardId, picks and elapsedS', async () => {
  fetchCalls = [];
  fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, grade: SERVER_GRADE, score: 123.4, pct: 0.61, matched: 3, elapsedS: 90 }) });
  const { container, root } = renderBoard();
  const btn = clickFinish(container);

  await act(async () => { btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });

  assert.equal(fetchCalls.length, 1, 'exactly one POST fired');
  const [url, init] = fetchCalls[0];
  assert.equal(url, '/api/daily/board/run');
  assert.equal(init.method, 'POST');
  const body = JSON.parse(init.body);
  assert.equal(body.boardId, 42, 'the boardId the page handed down');
  assert.equal(body.picks.length, 8, 'one pick per slot');
  assert.deepEqual(body.picks[0], { slotIndex: 0, teamKey: 'T0', playerName: 'P0' });
  assert.ok(!('points' in body.picks[0]), 'points are never sent - the server reads them off the frozen board');
  assert.ok(Number.isInteger(body.elapsedS) && body.elapsedS >= 89, `elapsedS came from the server clock, got ${body.elapsedS}`);
  act(() => root.unmount());
});

test('the grade screen renders THE SERVER\'S numbers, not a client grade', async () => {
  fetchCalls = [];
  fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, grade: SERVER_GRADE, score: 123.4, pct: 0.61, matched: 3, elapsedS: 90 }) });
  const { container, root } = renderBoard();
  await act(async () => { clickFinish(container).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });

  const text = container.textContent;
  assert.match(text, /123\.4/, "the server's score is on screen");
  assert.match(text, /61%/, "the server's pct is on screen");
  assert.match(text, /200/, "the server's perfect/ceiling is on screen");
  // The client grade of this play state would be 10+11+...+17 = 108, never 123.4.
  assert.doesNotMatch(text, /\b108\b/, 'the client-computed total must not appear');
  act(() => root.unmount());
});

test('A FAILED POST KEEPS THE BOARD AND THE PICKS, and shows an error', async () => {
  fetchCalls = [];
  fetchImpl = async () => ({ ok: false, json: async () => ({ error: 'boom' }) });
  const { container, root } = renderBoard();
  await act(async () => { clickFinish(container).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });

  const text = container.textContent;
  assert.match(text, /could not submit/i, 'the failure is stated');
  assert.match(text, /your picks are safe/i);
  assert.ok(clickFinish(container), 'the Finish button is still there to retry');
  assert.doesNotMatch(text, /points left on the board/i, 'no grade screen was shown');
  // And a retry actually re-fires.
  fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, grade: SERVER_GRADE, score: 123.4, pct: 0.61, matched: 3, elapsedS: 90 }) });
  await act(async () => { clickFinish(container).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(fetchCalls.length, 2, 'the retry fired a second POST');
  assert.match(container.textContent, /123\.4/, 'and the retry landed on the grade');
  act(() => root.unmount());
});

test('an already-ran board shows the STORED grade, not an error', async () => {
  fetchCalls = [];
  fetchImpl = async () => ({ ok: true, json: async () => ({ ok: true, alreadyRan: true, grade: SERVER_GRADE, score: 123.4, pct: 0.61, matched: 3, elapsedS: 55 }) });
  const { container, root } = renderBoard();
  await act(async () => { clickFinish(container).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.match(container.textContent, /123\.4/, 'the stored grade is rendered');
  assert.doesNotMatch(container.textContent, /could not submit/i, 'and it is not an error');
  act(() => root.unmount());
});

test('the unranked practice board does NOT post - it has no row to write', async () => {
  fetchCalls = [];
  fetchImpl = async () => { throw new Error('practice must not POST'); };
  const { container, root } = renderBoard({ ranked: false, boardId: null });
  await act(async () => { clickFinish(container).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(fetchCalls.length, 0, 'no request for a board with no daily_boards row');
  // IT REACHED THE CLIENT GRADER, which is the point. This fixture's twelve
  // teams each hold one QB, so solveBoard() cannot fill QB/RB/RB/WR/WR/FLEX/
  // FLEX/K and gradeBoard() honestly refuses - and ONLY the client path can
  // produce that refusal, because serverGrade is null here. A ranked board
  // reaching the same screen with no server grade renders the different
  // "No stored grade for this run." line instead, so the two are
  // distinguishable and this asserts the right one.
  assert.match(container.textContent, /no feasible grade/i, 'the client grader ran');
  assert.doesNotMatch(container.textContent, /no stored grade/i, 'not the ranked no-grade guard');
  act(() => root.unmount());
});
