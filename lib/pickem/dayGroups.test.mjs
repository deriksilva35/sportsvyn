// lib/pickem/dayGroups.test.mjs - the Pick'em board's day headings follow the
// READER's day (sun-16 item B).
//
// THE DEFECT: headings were the games' ET days while each row's time was the
// reader's, so a London reader saw a game at "12:20 AM BST" filed under
// "Sunday" - for them it was Monday.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByLockDay } from './dayGroups.js';

// SNF: 8:20 PM EDT Sunday = 00:20Z Monday = 1:20 AM BST Monday.
const BOARD = [
  { match_id: 1, kickoff_at: '2026-10-04T17:00:00Z' }, // Sun 1 PM ET / 6 PM BST
  { match_id: 2, kickoff_at: '2026-10-04T20:25:00Z' }, // Sun 4:25 PM ET / 9:25 PM BST
  { match_id: 3, kickoff_at: '2026-10-05T00:20:00Z' }, // Sun 8:20 PM ET / Mon 1:20 AM BST
];
const shape = (gs) => gs.map((g) => [g.label, g.games.map((x) => x.match_id)]);

test('London: the night game is under MONDAY, beside a row that says 1:20 AM', () => {
  assert.deepEqual(shape(groupByLockDay(BOARD, 'Europe/London')), [['Sunday', [1, 2]], ['Monday', [3]]]);
});

test('Los Angeles and the no-cookie fallback: one Sunday', () => {
  assert.deepEqual(shape(groupByLockDay(BOARD, 'America/Los_Angeles')), [['Sunday', [1, 2, 3]]]);
  assert.deepEqual(shape(groupByLockDay(BOARD, null)), [['Sunday', [1, 2, 3]]]);
});

test('Asia: the early window is already Monday too', () => {
  assert.deepEqual(shape(groupByLockDay(BOARD, 'Asia/Tokyo')), [['Monday', [1, 2, 3]]]);
});

test('the shared-lock flag still rides each group', () => {
  const g = groupByLockDay([BOARD[0], { match_id: 9, kickoff_at: BOARD[0].kickoff_at }], 'Europe/London');
  assert.equal(g.length, 1);
  assert.equal(g[0].sameLock, true);
  assert.equal(g[0].lockAt, BOARD[0].kickoff_at);
  assert.equal(groupByLockDay(BOARD, 'Europe/London')[0].sameLock, false);
});
