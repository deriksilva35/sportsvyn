// components/daily/season/seasonBoardPct.test.mjs - the served results screen
// says 99.7%, and says 100% nowhere.
//
// DERIK'S OWN BOARD, 2026-09-17: 2363.1 points against a ceiling of 2371.1,
// seven of eight matched, one MISSED row. Under the old whole-number rounding
// that screen read "100%" - a perfect board that was eight points short. This
// renders the real component and reads the real markup, because the bug was
// never in the arithmetic in the abstract; it was in what the page printed.

import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { transformSync } from '@babel/core';
import { pctOfCeiling } from '../../../lib/daily/format.js';
import { install } from '../../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let React; let createRoot; let act; let SeasonBoard; let dom; let tmp;
const roots = new Set();

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K'];
const p = (name, abbr, points, slot) => ({ name, abbr, points, slot, meta: '' });

/** gradeFromOptimum's own shape, at Derik's 2026-09-17 numbers. */
function grade() {
  const you = [
    p('J. Allen', 'BUF', 398.6, 'QB'), p('C. McCaffrey', 'SF', 391.5, 'RB'),
    p('J. Gibbs', 'DET', 286.1, 'RB'), p('T. Hill', 'MIA', 348.2, 'WR'),
    p('C. Lamb', 'DAL', 369.4, 'WR'), p('T. Kelce', 'KC', 231.6, 'TE'),
    p('P. Nacua', 'LAR', 294.1, 'FLEX'), p('B. Aubrey', 'DAL', 143.6, 'K'),
  ];
  const best = you.map((x) => ({ ...x }));
  // ONE MISSED ROW: the best roster held a better kicker at the K slot.
  best[7] = p('J. Tucker', 'BAL', 151.6, 'K');
  const rows = you.map((y, i) => ({
    hit: i !== 7, ahead: false, you: y, best: best[i], moved: null,
  }));
  return {
    ok: true,
    rows,
    mine: 2363.1,
    perfect: 2371.1,
    pct: 100, // the OLD whole-number field, still on the object and now unused
    matchedCount: 7,
    slotCount: 8,
    pointsLeft: 8,
    bestRosterAbbrs: best.map((x) => x.abbr),
    glyph: '🟩🟩🟩🟩🟩🟩🟩⬜',
    untouchedTeams: ['CIN', 'GB', 'MIN', 'PHI'],
    missedRows: [rows[7]],
  };
}

before(async () => {
  dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://sportsvyn.test/daily/board/2026-09-17' });
  global.window = dom.window; global.document = dom.window.document; global.self = dom.window;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
  global.HTMLElement = dom.window.HTMLElement; global.IS_REACT_ACT_ENVIRONMENT = true;
  global.fetch = async () => { throw new Error('the results screen must not fetch'); };
  React = (await import('react')).default ?? await import('react');
  ({ act } = await import('react'));
  ({ createRoot } = await import('react-dom/client'));
  const src = path.join(__dirname, 'SeasonBoard.js');
  const out = transformSync(readFileSync(src, 'utf8'), {
    filename: src, presets: [['@babel/preset-react', { runtime: 'automatic' }]], configFile: false, babelrc: false,
  }).code;
  tmp = path.join(__dirname, `__pct_test_${process.pid}.mjs`);
  writeFileSync(tmp, out.replace(/^'use client';\s*/m, ''));
  SeasonBoard = (await import(pathToFileURL(tmp).href)).default;
});
afterEach(() => { for (const r of roots) { try { act(() => r.unmount()); } catch { /* gone */ } } roots.clear(); });
after(() => { try { unlinkSync(tmp); } catch { /* gone */ } });

function results(g = grade()) {
  const c = document.getElementById('root');
  const root = createRoot(c); roots.add(root);
  act(() => root.render(React.createElement(SeasonBoard, {
    edition: 'The Daily · No. 031', year: '2021', teams: [], slots: SLOTS,
    ranked: true, userId: 1, boardId: 11,
    initialGrade: g, initialScreen: 'grade', initialClockLabel: '2:41',
    initialPlay: { slots: SLOTS, teams: [], roster: [], used: [] },
  })));
  return c;
}

test('THE RESULTS SCREEN SAYS 99.7%', () => {
  const c = results();
  assert.match(c.textContent, /99\.7%/, '2363.1 of 2371.1');
});

test('AND IT SAYS 100% NOWHERE - not in the header, the share card or the text', () => {
  const c = results();
  assert.doesNotMatch(c.textContent, /100%/,
    'a board eight points short must not read as a perfect one');
  assert.doesNotMatch(c.innerHTML, /100%/, 'nor in any attribute or title');
});

test('the percentage rides both lines: the share caption and the grade header', () => {
  const c = results();
  const hits = (c.textContent.match(/99\.7%/g) ?? []).length;
  assert.ok(hits >= 2, `the share caption and the grade header, found ${hits}`);
  assert.match(c.querySelector('.sbd-cap').textContent, /2,363\.1 pts · 99\.7% · 2:41/);
  assert.match(c.querySelector('.sbd-grade-top').textContent, /2,363\.1 pts · 99\.7% of 2,371\.1/);
});

test('a real perfect board is the ONLY thing that reads 100%', () => {
  const g = grade();
  const c = results({ ...g, mine: 2371.1, matchedCount: 8, pointsLeft: 0 });
  assert.match(c.textContent, /100%/);
  assert.doesNotMatch(c.textContent, /99\.9%/);
});

test('A ZERO CEILING READS "0.0%", per the full relay, and nothing divides by it', () => {
  const c = results({ ...grade(), perfect: 0 });
  assert.match(c.textContent, /0\.0%/);
  assert.doesNotMatch(c.textContent, /NaN|Infinity/, 'no arithmetic escaped onto the screen');
  assert.doesNotMatch(c.textContent, /100%/);
});

// A NULL CEILING IS NOT RENDERABLE ON THIS SCREEN AND NEVER WAS. The grade
// header's own line reads `of {grade.perfect.toLocaleString()}`, which throws
// on a null long before the percentage is reached - true before this relay and
// unchanged by it, because gradeFromOptimum always returns a numeric perfect.
// The formatter's null branch is covered in lib/daily/format.test.mjs; putting
// it on screen here would mean guarding a line this relay was not sent to
// touch. FILED, not fixed.
test('the formatter omits rather than inventing a percentage when the ceiling is unknown', () => {
  assert.equal(pctOfCeiling(2363.1, null), null);
});
