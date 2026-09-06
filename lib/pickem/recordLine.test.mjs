// lib/pickem/recordLine.test.mjs - the Pick'em row's rank+record line
// (relay 2c item 4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordLine } from './recordLine.js';

test('rank and record both present: "#12 · 3-0"', () => {
  assert.equal(recordLine(12, '3-0'), '#12 · 3-0');
});

test('record present, no rank (the common case - most teams are unranked): bare record', () => {
  assert.equal(recordLine(null, '3-0'), '3-0');
});

test("absent record renders '-' and nothing else, even with a rank", () => {
  assert.equal(recordLine(19, null), '-');
  assert.equal(recordLine(null, null), '-');
  assert.equal(recordLine(19, undefined), '-');
});

test("an empty-string record is treated as absent, not as a literal blank line", () => {
  assert.equal(recordLine(4, ''), '-');
});
