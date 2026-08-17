// lib/fantasy/yourDrafts.test.mjs - "Your drafts", split by action. PURE.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { splitDrafts, draftDate, draftAction } = await import('./yourDrafts.js');

const row = (o) => ({
  id: 1, status: 'completed', mode: 'sim', config_name: 'Standard 12 PPR',
  teams_count: 12, scoring_format: 'ppr', pick_position: 4, pick_count: 16,
  started_at: '2026-08-01T12:00:00Z', ...o,
});

test('three buckets, split by what you can DO with each', () => {
  const r = splitDrafts([
    row({ id: 1, status: 'in_progress' }),
    row({ id: 2, status: 'completed' }),
    row({ id: 3, mode: 'tracker', status: 'in_progress' }),
  ]);
  assert.deepEqual(r.open.map((x) => x.id), [1]);
  assert.deepEqual(r.done.map((x) => x.id), [2]);
  assert.deepEqual(r.tracker.map((x) => x.id), [3]);
});

test('A TRACKER ROOM IS A TRACKER ROW whatever its status', () => {
  // Its action differs from a mock's even when finished - you re-enter a room
  // you sat at, you re-read a mock you ran.
  const r = splitDrafts([row({ mode: 'tracker', status: 'completed' })]);
  assert.equal(r.tracker.length, 1);
  assert.equal(r.open.length + r.done.length, 0);
});

test('ABANDONED ROOMS ARE EXCLUDED - there is nothing to return to', () => {
  const r = splitDrafts([row({ status: 'abandoned' }), row({ id: 9, status: 'completed' })]);
  assert.deepEqual([...r.open, ...r.done, ...r.tracker].map((x) => x.id), [9]);
});

test('a custom config is labelled by its SHAPE, not by the word Custom', () => {
  assert.equal(splitDrafts([row({ config_name: 'Custom' })]).done[0].label, '12-team PPR');
  assert.equal(splitDrafts([row({ config_name: null })]).done[0].label, '12-team PPR');
  assert.equal(splitDrafts([row({})]).done[0].label, 'Standard 12 PPR');
});

test('every row carries a href, so nothing needs a remembered URL', () => {
  const r = splitDrafts([row({ id: 42 })]);
  assert.equal(r.done[0].href, '/sim/draft/42');
});

test('the verb is the difference between the buckets', () => {
  assert.equal(draftAction({ mode: 'sim', status: 'in_progress' }), 'Resume');
  assert.equal(draftAction({ mode: 'sim', status: 'completed' }), 'See the board');
  assert.equal(draftAction({ mode: 'tracker', status: 'in_progress' }), 'Re-enter');
  assert.equal(draftAction({ mode: 'tracker', status: 'completed' }), 'See the board');
});

test('a bad date is ABSENT rather than "Invalid Date"', () => {
  assert.equal(draftDate(null), null);
  assert.equal(draftDate('nonsense'), null);
  assert.ok(draftDate('2026-08-01T12:00:00Z'));
});

test('an empty list produces three empty buckets, not null', () => {
  const r = splitDrafts([]);
  assert.deepEqual([r.open, r.tracker, r.done], [[], [], []]);
  assert.deepEqual(splitDrafts().open, []);
});
