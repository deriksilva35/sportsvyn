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

test('a null, missing, zero or non-finite ceiling returns null - never "0%", never a dash', () => {
  for (const bad of [null, undefined, 0, '0', NaN, Infinity, -5, 'x']) {
    assert.equal(pctOfCeiling(100, bad), null, String(bad));
  }
});

test('a missing score returns null too - a DNF has no share of anything', () => {
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
});

test('strings are accepted, because a numeric column arrives as one', () => {
  assert.equal(pctOfCeiling('2363.1', '2371.1'), '99.7%');
});

// ---------------------------------------------------------------------------
// ONE FORMATTER
// ---------------------------------------------------------------------------

const DISPLAY_SURFACES = [
  'components/daily/season/SeasonBoard.js',
  'lib/daily/seasonBoardResults.js',
  'app/daily/board/[date]/page.js',
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
  for (const rel of ['components/daily/season/SeasonBoard.js', 'lib/daily/seasonBoardResults.js']) {
    assert.match(strip(src(rel)), /pctOfCeiling\(/, `${rel} uses the formatter`);
  }
});

test('the formatter itself is the only place the arithmetic lives', () => {
  const code = strip(src('lib/daily/format.js'));
  assert.equal((code.match(/\*\s*1000/g) ?? []).length, 1, 'one rounding, in one place');
  assert.match(code, /export function pctOfCeiling/);
});
