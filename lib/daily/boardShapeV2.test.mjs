// lib/daily/boardShapeV2.test.mjs - the ranked shape, the legacy shape, and
// the rule that decides which one a stored board is read with (v2.0).
//
// THE TEST THAT MATTERS MOST IS "A FROZEN BOARD KEEPS ITS OWN SHAPE". Eleven
// of the seventeen runs stored on PROD would have stopped regrading if the
// reader kept importing the constant; slotsOf() is the whole fix, so it is
// checked against the two shapes AND against a row written before the column
// existed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOTS, LEGACY_SLOTS, slotsOf, RANKED_MIN_SEASON, eligibleForSlot, BOARD_POSITIONS,
} from './boardShape.js';

test('the ranked eight are QB RB RB WR WR TE FLEX K, in that order', () => {
  assert.deepEqual([...SLOTS], ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K']);
  assert.equal(SLOTS.length, 8);
});

test('the legacy eight are still the old two-FLEX shape', () => {
  assert.deepEqual([...LEGACY_SLOTS], ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K']);
});

test('FLEX takes RB, WR or TE - and never QB or K', () => {
  for (const p of ['RB', 'WR', 'TE']) assert.equal(eligibleForSlot(p, 'FLEX'), true, p);
  for (const p of ['QB', 'PK']) assert.equal(eligibleForSlot(p, 'FLEX'), false, p);
});

test('THE TE SLOT TAKES ONLY A TIGHT END', () => {
  assert.equal(eligibleForSlot('TE', 'TE'), true);
  for (const p of ['WR', 'RB', 'QB', 'PK']) assert.equal(eligibleForSlot(p, 'TE'), false, p);
});

test('the K slot still means the stored PK position', () => {
  // A literal slot===position compare would make every K slot infeasible.
  assert.equal(eligibleForSlot('PK', 'K'), true);
  assert.equal(eligibleForSlot('K', 'K'), false);
  assert.deepEqual([...BOARD_POSITIONS], ['QB', 'RB', 'WR', 'TE', 'PK']);
});

test('A BOARD IS READ WITH ITS OWN SHAPE, never today\'s constant', () => {
  assert.deepEqual(slotsOf({ slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K'] }), SLOTS);
  assert.deepEqual(slotsOf({ slots: ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'] }), LEGACY_SLOTS);
});

test('a board written before the column falls back to the LEGACY shape', () => {
  // Nine editions existed before migrations/103 and were played under the two
  // FLEX slots. Defaulting them to the ranked shape is exactly the breakage
  // the column exists to prevent, so the fallback must not be SLOTS.
  assert.deepEqual(slotsOf({}), LEGACY_SLOTS);
  assert.deepEqual(slotsOf(null), LEGACY_SLOTS);
  assert.deepEqual(slotsOf({ slots: null }), LEGACY_SLOTS);
  assert.deepEqual(slotsOf({ slots: [] }), LEGACY_SLOTS);
  assert.notDeepEqual(slotsOf({}), SLOTS);
});

test('the ranked floor is 2002, and it is a number the generator can compare', () => {
  assert.equal(RANKED_MIN_SEASON, 2002);
  assert.equal(typeof RANKED_MIN_SEASON, 'number');
});
