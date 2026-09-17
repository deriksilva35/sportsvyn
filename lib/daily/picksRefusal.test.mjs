// lib/daily/picksRefusal.test.mjs - what buildRosterFromPicks SAYS when it
// refuses. PURE: no database, no board needed beyond a stub.
//
// THE ONE THAT MATTERS IS NULL. A started-but-unsubmitted run has picks NULL
// (startRun writes the row before the board is handed over, and a DNF stays
// that way), and typeof null is 'object' in JavaScript - so this refusal used
// to read "expected 8 picks, got object", which is the sentence of a malformed
// payload rather than of an unfinished attempt. It was read as corrupt data
// twice. The rest of the refusals are pinned alongside it so the fix cannot
// quietly change what any of the others say.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRosterFromPicks } from './seasonBoardRuns.js';

const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K'];
const BOARD = { board: [], slots: SLOTS };
const reasonFor = (picks) => buildRosterFromPicks(BOARD, picks, SLOTS).reason;

test('A NULL IS "null", not "object" - an unfinished run, not a broken one', () => {
  assert.equal(reasonFor(null), 'expected 8 picks, got null');
});

test('undefined still says undefined', () => {
  assert.equal(reasonFor(undefined), 'expected 8 picks, got undefined');
});

test('a real object says object, which is what that word is for', () => {
  assert.equal(reasonFor({ 0: 'QB' }), 'expected 8 picks, got object');
});

test('a short or long array reports its LENGTH, unchanged', () => {
  assert.equal(reasonFor([]), 'expected 8 picks, got 0');
  assert.equal(reasonFor([1, 2, 3]), 'expected 8 picks, got 3');
  assert.equal(reasonFor(new Array(9).fill(null)), 'expected 8 picks, got 9');
});

test('a string says string', () => {
  assert.equal(reasonFor('eight'), 'expected 8 picks, got string');
});

test('the refusal is a refusal - ok:false and no roster, every time', () => {
  for (const bad of [null, undefined, {}, [], 'x', 7]) {
    const r = buildRosterFromPicks(BOARD, bad, SLOTS);
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.roster, undefined);
  }
});
