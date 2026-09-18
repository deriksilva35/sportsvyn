// lib/games/chips.test.mjs - THE OLD ?pane= URLS KEEP WORKING.
//
// v3 has four chips where v2 had four panes, and they do not line up: v2's
// `answer` and `history` are both "what happened", which the mock calls
// Results. Every URL that exists today - shared, bookmarked, linked from an
// email - has to land somewhere sensible, so the mapping is a table with a
// test rather than a rename and a hope.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChip, V3_CHIPS, V3_CHIP_LABEL, PANES } from './lobby.js';

test('every v2 pane maps onto a chip', () => {
  assert.equal(normalizeChip('games'), 'week');
  assert.equal(normalizeChip('leaderboards'), 'boards');
  assert.equal(normalizeChip('history'), 'results');
  assert.equal(normalizeChip('answer'), 'results', "the Daily's latest answer is a result");
  // AND NO v2 PANE IS ORPHANED - if PANES grows, this fails until the map does.
  for (const p of PANES) {
    assert.ok(V3_CHIPS.includes(normalizeChip(p)), `${p} maps nowhere`);
  }
});

test('a chip name is its own value, so ?pane=boards works', () => {
  for (const c of V3_CHIPS) assert.equal(normalizeChip(c), c);
});

test('anything unrecognised falls back to This week, never to a blank screen', () => {
  for (const junk of ['', null, undefined, 'nonsense', '../etc/passwd', 42]) {
    assert.equal(normalizeChip(junk), 'week');
  }
});

test('the four chips are the four the mock draws, in its order', () => {
  assert.deepEqual(V3_CHIPS, ['week', 'boards', 'results', 'alerts']);
  assert.deepEqual(Object.values(V3_CHIP_LABEL), ['This week', 'Boards', 'Results', 'Alerts']);
});
