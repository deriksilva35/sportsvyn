// lib/gridiron/oddsFormat.test.mjs — pure display-math helpers. No env, no DB.
// Run: node --test lib/gridiron/oddsFormat.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTwoWayPct, formatAmerican, formatSignedPct, probDirection, isPreGame,
} from './oddsFormat.js';

test('normalizeTwoWayPct: clean pair', () => {
  assert.deepEqual(normalizeTwoWayPct(60, 40), { a: 60, b: 40 });
  assert.deepEqual(normalizeTwoWayPct(50, 50), { a: 50, b: 50 });
});

test('normalizeTwoWayPct: de-vig drift still sums to EXACTLY 100', () => {
  const r = normalizeTwoWayPct(66.7, 33.4); // total 100.1
  assert.equal(r.a + r.b, 100);
  const r2 = normalizeTwoWayPct(61.53, 38.51); // total 100.04
  assert.equal(r2.a + r2.b, 100);
});

test('normalizeTwoWayPct: null on unusable input', () => {
  assert.equal(normalizeTwoWayPct(0, 0), null);
  assert.equal(normalizeTwoWayPct(null, 50), null);
  assert.equal(normalizeTwoWayPct(NaN, 1), null);
});

test('formatAmerican', () => {
  assert.equal(formatAmerican(150), '+150');
  assert.equal(formatAmerican(-110), '-110');
  assert.equal(formatAmerican(null), null);
});

test('formatSignedPct', () => {
  assert.equal(formatSignedPct(1.2), '+1.20%');
  assert.equal(formatSignedPct(-0.5), '-0.50%');
  assert.equal(formatSignedPct(0), '0.00%');
});

test('probDirection: up/down/flat', () => {
  assert.equal(probDirection(1.2), 'up');
  assert.equal(probDirection(-0.3), 'down');
  assert.equal(probDirection(0), 'flat');
  assert.equal(probDirection(null), 'flat');
});

test('isPreGame: scheduled only (freeze-at-kickoff)', () => {
  assert.equal(isPreGame('scheduled'), true);
  assert.equal(isPreGame('live'), false);
  assert.equal(isPreGame('final'), false);
});
