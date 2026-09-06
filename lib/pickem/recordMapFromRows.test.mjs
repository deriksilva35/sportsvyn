// lib/pickem/recordMapFromRows.test.mjs - '0-0' vs '-' is the row's own
// existence, not the score (relay 2c-fix item 2). PURE: no DB, so it needs
// no live team_records table - DEV currently has none at all (a schema gap
// unrelated to this logic, flagged separately).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordMapFromRows } from './entry.js';

test('a row at 0-0 renders as the string "0-0" - the row EXISTING is the fact', () => {
  const map = recordMapFromRows([{ team_id: 1, wins: 0, losses: 0, ties: 0 }], [1]);
  assert.equal(map.get(1), '0-0');
});

test('a team with no row at all is absent from the map, never a fabricated dash or zero', () => {
  const map = recordMapFromRows([{ team_id: 1, wins: 3, losses: 0, ties: 0 }], [1, 2]);
  assert.equal(map.get(1), '3-0');
  assert.equal(map.has(2), false, 'team 2 has no row - absent, not "0-0"');
});

test('a real, non-zero record still renders normally', () => {
  const map = recordMapFromRows([{ team_id: 1, wins: 9, losses: 3, ties: 0 }], [1]);
  assert.equal(map.get(1), '9-3');
});

test('a row for a team not in teamIds is ignored, never leaks into the map', () => {
  const map = recordMapFromRows([{ team_id: 99, wins: 1, losses: 0, ties: 0 }], [1]);
  assert.equal(map.size, 0);
});

test('no rows at all: every requested team is absent', () => {
  const map = recordMapFromRows([], [1, 2]);
  assert.equal(map.size, 0);
});
