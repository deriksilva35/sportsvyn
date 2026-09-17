// lib/daily/format.test.mjs - pctOfCeiling, and the rule that there is only
// one of it. PURE: numbers in, a string or null out.
//
// EVERY CASE HERE IS A WAY THE OLD LINE COULD LIE. It printed
// `Math.round((mine / perfect) * 100)%` in three places, which made 99.66%
// read as "100%" - a perfect board that was eight points short - and made a
// zero ceiling read as "100%" as well.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pctOfCeiling } from './format.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
// COMMENTS STRIPPED BEFORE THE ABSENCE CHECK, per the relay: this file's own
// prose describes the arithmetic it forbids, and a grep that counted comments
// would forbid explaining itself.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// NO CEILING, NO PERCENTAGE
// ---------------------------------------------------------------------------

test('A ZERO CEILING IS "0.0%" - stated by the full relay, and no division happens', () => {
  assert.equal(pctOfCeiling(100, 0), '0.0%');
  assert.equal(pctOfCeiling(0, 0), '0.0%');
  assert.equal(pctOfCeiling(100, '0'), '0.0%');
  assert.equal(pctOfCeiling(100, -5), '0.0%', 'a negative ceiling is not a ceiling either');
  // The earlier truncated send of this relay said null-and-omit here. This
  // follows the complete one.
});

test('A CEILING WE DO NOT HAVE returns null, and the caller omits the line', () => {
  for (const bad of [null, undefined, NaN, Infinity, 'x']) {
    assert.equal(pctOfCeiling(100, bad), null, String(bad));
  }
});

test('THE DNF PATH IS PINNED, NOT CHANGED: a missing score renders no percentage', () => {
  // Today a run with no picks never reaches a grade screen at all - youCellV2
  // returns {played:false, dnf:true} and the page renders the DNF branch. So
  // the formatter returning null here keeps that path exactly as it is: there
  // is nothing new on screen, and nothing crashes if one ever arrives.
  assert.equal(pctOfCeiling(null, 2371.1), null);
  assert.equal(pctOfCeiling(undefined, 2371.1), null);
  assert.equal(pctOfCeiling(NaN, 2371.1), null);
});

// ---------------------------------------------------------------------------
// "100%" IS EARNED
// ---------------------------------------------------------------------------

test('the exact ceiling, and only the exact ceiling, is "100%"', () => {
  assert.equal(pctOfCeiling(2371.1, 2371.1), '100%');
  assert.equal(pctOfCeiling(2400, 2371.1), '100%', 'above the ceiling is still 100');
  assert.equal(pctOfCeiling(100, 100), '100%');
});

test('THE CAP: a board that fell short never reads 100 in any form', () => {
  // 2370.9 of 2371.1 is 99.9916%, which rounds to 100.0 at one decimal.
  assert.equal(pctOfCeiling(2370.9, 2371.1), '99.9%');
  assert.equal(pctOfCeiling(2371.09, 2371.1), '99.9%');
  // and the nearest thing below the cap still rounds normally
  assert.equal(pctOfCeiling(2369, 2371.1), '99.9%');
});

// ---------------------------------------------------------------------------
// ONE DECIMAL, ORDINARY ROUNDING
// ---------------------------------------------------------------------------

test('DERIK\'S BOARD: 2363.1 of 2371.1 is 99.7%, not 100%', () => {
  const out = pctOfCeiling(2363.1, 2371.1);
  assert.equal(out, '99.7%');
  assert.notEqual(out, '100%', 'the whole point of this formatter');
});

test('90.2%: 1840.2 of 2039.4', () => {
  assert.equal(pctOfCeiling(1840.2, 2039.4), '90.2%');
});

test('ordinary rounding, both directions, and the decimal is always there', () => {
  assert.equal(pctOfCeiling(9966, 10000), '99.7%', '99.66 rounds up');
  assert.equal(pctOfCeiling(9964, 10000), '99.6%', '99.64 rounds down');
  assert.equal(pctOfCeiling(5000, 10000), '50.0%', 'a round number keeps its decimal');
  assert.equal(pctOfCeiling(0, 10000), '0.0%', 'a real zero score is a real 0.0%');
  assert.equal(pctOfCeiling(2370.99, 2371.1), '99.9%', "the relay's own second case");
});

test('strings are accepted, because a numeric column arrives as one', () => {
  assert.equal(pctOfCeiling('2363.1', '2371.1'), '99.7%');
});

// ---------------------------------------------------------------------------
// ONE FORMATTER
// ---------------------------------------------------------------------------

// EVERY SURFACE THAT WRITES A DAILY SCORE AS A SHARE OF ITS CEILING. Seven
// call sites across five files, all through pctOfCeiling: the results header
// bar and the share card (SeasonBoard), the lobby's Yesterday line and its
// "you" cell (seasonBoardResults), the lobby's Daily row (dailyRow), and the
// leaderboards' main and best tabs. The v1 Daily's bonus and tier percentages
// are a different number on a different game and are deliberately not here.
const DISPLAY_SURFACES = [
  'components/daily/season/SeasonBoard.js',
  'lib/daily/seasonBoardResults.js',
  'app/daily/board/[date]/page.js',
  'lib/games/dailyRow.js',
  'app/daily/leaderboards/page.js',
];

test('NO DISPLAY SURFACE DOES ITS OWN SHARE-OF-CEILING ARITHMETIC', () => {
  for (const rel of DISPLAY_SURFACES) {
    const code = strip(src(rel));
    assert.doesNotMatch(code, /\/\s*(ceiling|perfect)[^\n]*\*\s*100/,
      `${rel} computes a percentage of its own`);
    assert.doesNotMatch(code, /grade\.pct\b/,
      `${rel} still prints the whole-number grade.pct`);
  }
});

test('and each of them calls the one formatter', () => {
  for (const rel of [
    'components/daily/season/SeasonBoard.js',
    'lib/daily/seasonBoardResults.js',
    'lib/games/dailyRow.js',
    'app/daily/leaderboards/page.js',
  ]) {
    assert.match(strip(src(rel)), /pctOfCeiling\(/, `${rel} uses the formatter`);
  }
});

test('NO SURFACE PRINTS A BARE % BESIDE A DAILY PERCENTAGE - the formatter carries it', () => {
  // The formatter returns "99.7%", so a caller that kept its own literal %
  // would render "99.7%%". These are the four JSX sites that used to.
  for (const rel of ['app/games/page.js', 'app/daily/leaderboards/page.js']) {
    const code = strip(src(rel));
    assert.doesNotMatch(code, /\{(?:y|h)\.you\.pct\}%/, `${rel} doubles the sign`);
    assert.doesNotMatch(code, /Math\.round\(r\.primary \* 1000\)/, `${rel} rounds its own`);
  }
});

test('the formatter itself is the only place the arithmetic lives', () => {
  const code = strip(src('lib/daily/format.js'));
  assert.equal((code.match(/\*\s*1000/g) ?? []).length, 1, 'one rounding, in one place');
  assert.match(code, /export function pctOfCeiling/);
});
