// components/daily/season/seasonBoardReceipt.test.mjs - the RECEIPT renders.
//
// The first time a submitted run was ever opened (8 Sep 2026) /daily/board
// threw "Cannot read properties of undefined (reading 'filter')" - twice,
// digest 1010057789 - because the play object rebuilt for the receipt had no
// `teams` and SeasonBoard calls teamsLeft(play) on every render. No test had
// ever rendered that branch. This one does, press-the-button style, with the
// props JSON round-tripped first because that is what the RSC boundary does
// to them (and what strips a Set).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { install } from '../../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
const FX = JSON.parse(readFileSync(path.join(REPO, 'lib/daily/fixtures/board-2026-09-08.json'), 'utf8'));

let React, createRoot, act, SeasonBoard, dom, tmp, regradeStoredRun, SLOTS;

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/daily/board' });
  global.window = dom.window; global.document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.self = dom.window;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async () => { throw new Error('the receipt must not fetch'); };
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  ({ regradeStoredRun } = await import('../../../lib/daily/seasonBoardRuns.js'));
  ({ SLOTS } = await import('../../../lib/daily/boardShape.js'));
  const src = path.join(__dirname, 'SeasonBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), { filename: src,
    presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false }).code;
  tmp = path.join(__dirname, `__receipt_test_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  SeasonBoard = (await import(pathToFileURL(tmp).href)).default;
});
after(() => { try { unlinkSync(tmp); } catch { /* gone */ } });

test('4b. the receipt branch renders without throwing, and shows four matched', () => {
  const board = { id: FX.board_id, ceiling: FX.ceiling, board: FX.board, best_roster: FX.best_roster };
  const regraded = regradeStoredRun(board, FX.picks, SLOTS);
  // ACROSS THE BOUNDARY: exactly what the server component hands the client.
  const props = JSON.parse(JSON.stringify({
    edition: 'The Daily · 2026-09-08', year: '2015', teams: FX.board, slots: SLOTS, ranked: true,
    userId: 1, boardId: FX.board_id,
    initialPlay: regraded.play, initialGrade: regraded.grade, initialClockLabel: '31:28',
    streak: 1, closesAt: '2026-09-09T04:00:00.000Z', todayRows: null,
  }));
  assert.ok(Array.isArray(props.initialPlay.used), 'the boundary turned used into an array');

  const container = document.getElementById('root');
  const root = createRoot(container);
  assert.doesNotThrow(() => act(() => root.render(React.createElement(SeasonBoard, props))));

  const text = container.textContent;
  assert.match(text, /4 of 8 matched/, 'four matched, from the stored grade');
  assert.match(text, /1,840\.2 pts · 90%/);
  assert.doesNotMatch(text, /undefined/, 'no undefined anywhere on the receipt');
  assert.match(text, /DeAndre Hopkins \(HOU\)/, 'the story names the biggest miss');
  // Best-roster cells carry names: Frank Gore is on the best roster and not on Derik's.
  assert.match(text, /Frank Gore/);
  act(() => root.unmount());
});
