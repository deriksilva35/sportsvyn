// lib/games/seatRangeLabel.test.mjs - the undrafted-seat summary line
// (relay 2b-fix item 6). PURE, no DB.

import test from 'node:test';
import assert from 'node:assert/strict';
import { seatRangeLabel } from './leaderboard.js';

test("the relay's own example collapses exactly as written", () => {
  assert.equal(seatRangeLabel([1, 2, 4, 5, 6, 8, 9, 10, 11, 12]), '1, 2, 4-6, 8-12');
});

test('a run of two stays a list - the hyphen saves nothing at two', () => {
  assert.equal(seatRangeLabel([4, 5]), '4, 5');
  assert.equal(seatRangeLabel([4, 5, 6]), '4-6');
});

test('single seats, and singles between runs', () => {
  assert.equal(seatRangeLabel([7]), '7');
  assert.equal(seatRangeLabel([1, 3, 5]), '1, 3, 5');
  assert.equal(seatRangeLabel([1, 2, 3, 7, 9, 10, 11]), '1-3, 7, 9-11');
});

test('input order and duplicates do not matter', () => {
  assert.equal(seatRangeLabel([12, 1, 2, 11, 10, 2]), '1, 2, 10-12');
});

test('nothing undrafted renders nothing, not an empty range', () => {
  assert.equal(seatRangeLabel([]), '');
  assert.equal(seatRangeLabel(null), '');
  assert.equal(seatRangeLabel(undefined), '');
});

test('every seat undrafted is one clean range', () => {
  assert.equal(seatRangeLabel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), '1-12');
});
