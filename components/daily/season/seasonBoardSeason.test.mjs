// components/daily/season/seasonBoardSeason.test.mjs - the play screen states
// its season, on every board.
//
// WHAT WENT WRONG. The rules card says the year once, in large type, and then
// it is gone for the rest of the round. From that point the play screen named
// twelve teams, eight slots, a clock and a points total, and nowhere the one
// fact that decides every pick: WHICH SEASON these players' numbers are from.
// A 1987 board and a 2024 board looked identical.
//
// WHERE THE YEAR COMES FROM. The board row's own season_year - both edition
// routes read `year = String(board.season_year)`, and the free-play preview
// passes the era it drew from. Nothing here is threaded off a route param, so
// a free-play board in a chosen era carries its year for nothing.
//
// SAME PRESS-THE-BUTTON HARNESS as the other SeasonBoard tests, and every root
// is unmounted in afterEach.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { install } from '../../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../../lib/testing/stubDir.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
let React; let createRoot; let act; let SeasonBoard; let dom; let tmp;
const roots = new Set();

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K'];
const TEAMS = Array.from({ length: 12 }, (_, i) => ({
  key: `T${i}`,
  abbr: `T${i}`,
  card: [
    { position: 'QB', name: `QB ${i}`, points: 300 - i, meta: '4,000 yds · 30 TD' },
    { position: 'RB', name: `RB ${i}`, points: 250 - i, meta: '1,200 yds · 10 TD' },
    { position: 'WR', name: `WR ${i}`, points: 240 - i, meta: '100 rec · 1,400' },
    { position: 'TE', name: `TE ${i}`, points: 200 - i, meta: '80 rec · 850' },
    { position: 'PK', name: `PK ${i}`, points: 140 - i, meta: '30/33 FG · 45 XP' },
    { position: 'RB', name: `RB2 ${i}`, points: 120 - i, meta: '700 yds · 4 TD' },
  ],
}));

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/daily/board' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async () => { throw new Error('these states must not fetch'); };
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'SeasonBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), {
    filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false,
  }).code;
  tmp = stubPath(`__season_test_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  SeasonBoard = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { try { unlinkSync(tmp); } catch { /* gone */ } });

/** The PLAY screen, past the rules card, for one board's season. */
function play({ year, edition = 'The Daily · 2026-09-18', ...rest } = {}) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(SeasonBoard, {
    edition, year, teams: TEAMS, slots: SLOTS,
    ranked: true, userId: 1, boardId: 3,
    initialScreen: 'board', initialStartedAt: new Date().toISOString(),
    ...rest,
  })));
  return c;
}

const title = (c) => c.querySelector('.sbd-eb').textContent;
const eyebrow = (c) => c.querySelector('.sbd-ed2').textContent;
const note = (c) => c.querySelector('.sbd-note').textContent;

// ---------------------------------------------------------------------------
// A 2024 BOARD AND A 1987 BOARD, each carrying its own year
// ---------------------------------------------------------------------------

test('A 2024 BOARD: the header title is "The Daily · 2024"', () => {
  const c = play({ year: '2024' });
  assert.equal(title(c), 'The Daily · 2024');
});

test('A 1987 BOARD: the same header carries 1987, and no 2024 anywhere', () => {
  const c = play({ year: '1987' });
  assert.equal(title(c), 'The Daily · 1987');
  assert.doesNotMatch(c.textContent, /2024/);
});

test('THE STRIP LINE NAMES THE SEASON ONCE, in the relay\'s words', () => {
  const c = play({ year: '2024' });
  assert.equal(note(c),
    'Fill eight slots from twelve teams, one player each. Their real 2024 season points are your score. Tap a team to see its six.');
});

test('and it is the board\'s year on the 1987 board too', () => {
  const c = play({ year: '1987' });
  assert.match(note(c), /Their real 1987 season points are your score\./);
});

test('THE EDITION DATE STAYS IN THE RIGHT-HAND EYEBROW', () => {
  const c = play({ year: '2024', edition: 'The Daily · 2026-09-18' });
  assert.equal(eyebrow(c), '2026-09-18');
  // AND THE NAME OF THE GAME IS SAID ONCE. The routes compose `edition` with
  // its own "The Daily · " prefix, which beside the new title read twice.
  assert.equal((c.querySelector('.sbd-hd-top').textContent.match(/The Daily/g) ?? []).length, 1);
});

test('a numbered edition keeps its number in the eyebrow', () => {
  const c = play({ year: '2021', edition: 'The Daily · No. 031' });
  assert.equal(eyebrow(c), 'No. 031');
  assert.equal(title(c), 'The Daily · 2021');
});

test('FREE PLAY GETS ITS ERA FOR NOTHING - the preview\'s own edition string', () => {
  const c = play({ year: '1998', edition: 'The Daily · Season 1998 preview', ranked: false });
  assert.equal(title(c), 'The Daily · 1998');
  assert.equal(eyebrow(c), 'Season 1998 preview');
  assert.match(note(c), /Their real 1998 season points/);
});

// ---------------------------------------------------------------------------
// THE SEASON IS THE BOARD'S, NOT THE ROUTE'S
// ---------------------------------------------------------------------------

test('both edition routes take the year from the board row, and only from there', () => {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
  for (const rel of ['app/daily/board/page.js', 'app/daily/board/[date]/page.js']) {
    const code = strip(readFileSync(path.join(REPO, rel), 'utf8'));
    assert.match(code, /const year = String\(board\.season_year\)/, `${rel} reads the board row`);
  }
  // The free-play preview has no row to read; it passes the era it drew from,
  // which is the same number the draw's own query filtered on.
  const boardRoute = strip(readFileSync(path.join(REPO, 'app/daily/board/page.js'), 'utf8'));
  assert.match(boardRoute, /year=\{String\(season\)\}/);
  assert.match(boardRoute, /WHERE season_year = \$\{season\}/);
  // AND THE COMPONENT NEVER READS A SEARCH PARAM ITSELF.
  const board = strip(readFileSync(path.join(REPO, 'components/daily/season/SeasonBoard.js'), 'utf8'));
  assert.doesNotMatch(board, /useSearchParams|searchParams/);
});

// ---------------------------------------------------------------------------
// THE RESULTS SCREEN IS UNCHANGED
// ---------------------------------------------------------------------------

const p = (name, abbr, points, slot) => ({ name, abbr, points, slot, meta: '' });
function grade() {
  const you = [
    p('J. Allen', 'BUF', 398.6, 'QB'), p('C. McCaffrey', 'SF', 391.5, 'RB'),
    p('J. Gibbs', 'DET', 286.1, 'RB'), p('T. Hill', 'MIA', 348.2, 'WR'),
    p('C. Lamb', 'DAL', 369.4, 'WR'), p('T. Kelce', 'KC', 231.6, 'TE'),
    p('P. Nacua', 'LAR', 294.1, 'FLEX'), p('B. Aubrey', 'DAL', 143.6, 'K'),
  ];
  const best = you.map((x) => ({ ...x }));
  const rows = you.map((y, i) => ({ hit: true, ahead: false, you: y, best: best[i], moved: null }));
  return {
    ok: true, rows, mine: 2363.1, perfect: 2371.1, matchedCount: 8, slotCount: 8,
    pointsLeft: 8, bestRosterAbbrs: best.map((x) => x.abbr), glyph: '🟩🟩🟩🟩🟩🟩🟩🟩',
    untouchedTeams: [], missedRows: [],
  };
}

test('THE RESULTS SCREEN STILL STATES THE YEAR EXACTLY ONCE IN ITS BAR', () => {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(SeasonBoard, {
    edition: 'The Daily · No. 031', year: '2024', teams: [], slots: SLOTS,
    ranked: true, userId: 1, boardId: 11,
    initialGrade: grade(), initialScreen: 'grade', initialClockLabel: '2:41',
    initialPlay: { slots: SLOTS, teams: [], roster: [], used: [] },
  })));
  // THE BAR IS .sbd-grade-top: the year on the left, the score against the
  // ceiling on the right. FIX 2 does not touch this screen.
  const bar = c.querySelector('.sbd-grade-top');
  assert.equal((bar.textContent.match(/2024/g) ?? []).length, 1, `the bar reads: ${bar.textContent}`);
  assert.equal(bar.querySelector('b').textContent, '2024');
  assert.match(bar.textContent, /2,363\.1 pts · 99\.7% of 2,371\.1/);
  // AND THE RESULTS HEADER STILL PRINTS `edition` WHOLE - no tail-stripping on
  // this screen, which is where the "The Daily · No. 031" reading belongs.
  assert.equal(c.querySelector('.sbd-ed').textContent, 'The Daily · No. 031');
  assert.equal(c.querySelector('.sbd-eb'), null, 'the play header is not on the results screen');
});
