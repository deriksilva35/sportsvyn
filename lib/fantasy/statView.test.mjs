// lib/fantasy/statView.test.mjs - sort semantics for the available board.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sortsFor, sortPlayers, viewFor } from './statView.js';

const P = (id, adp) => ({ ffcPlayerId: id, adp });
const opt = (filter, key) => sortsFor(filter).find((o) => o.key === key);
const ids = (list) => list.map((p) => p.ffcPlayerId);
const sum = (totals, extra = {}) => ({ totals, points: 0, ppg: 0, games: 17, ...extra });

test('ADP/PPG/PTS are offered on every board; stat keys only once filtered', () => {
  assert.deepEqual(sortsFor('ALL').map((o) => o.key), ['adp', 'ppg', 'points']);
  assert.ok(sortsFor('WR').map((o) => o.key).includes('rec'));
  assert.ok(sortsFor('QB').map((o) => o.key).includes('passTd'));
  assert.ok(!sortsFor('QB').map((o) => o.key).includes('rec')); // receptions are not a QB sort
});

test('TE reuses the WR receiving sorts', () => {
  assert.deepEqual(sortsFor('TE').map((o) => o.key), sortsFor('WR').map((o) => o.key));
  assert.deepEqual(viewFor('TE').columns, viewFor('WR').columns);
});

test('a stat sort ranks high-to-low', () => {
  const list = [P('a', 10), P('b', 20), P('c', 30)];
  const summaries = { a: sum({ rec: 40 }), b: sum({ rec: 100 }), c: sum({ rec: 70 }) };
  assert.deepEqual(ids(sortPlayers(list, opt('WR', 'rec'), summaries)), ['b', 'c', 'a']);
});

test('INT sorts ascending: fewer is better', () => {
  const list = [P('a', 10), P('b', 20)];
  const summaries = { a: sum({ int: 12 }), b: sum({ int: 3 }) };
  assert.deepEqual(ids(sortPlayers(list, opt('QB', 'int'), summaries)), ['b', 'a']);
});

test('UNKNOWN sorts last, never as a zero - "no data" is not "was bad"', () => {
  const list = [P('a', 10), P('nostats', 20), P('c', 30)];
  const summaries = { a: sum({ rec: 5 }), c: sum({ rec: 90 }) };
  // 'a' has a WORSE line than 'c' but still outranks the unknown player.
  assert.deepEqual(ids(sortPlayers(list, opt('WR', 'rec'), summaries)), ['c', 'a', 'nostats']);
});

test('unknown sorts last even when the direction is ascending', () => {
  const list = [P('nostats', 5), P('b', 20)];
  const summaries = { b: sum({ int: 30 }) };
  // asc would put a 0 first if unknown were coerced; it must not be.
  assert.deepEqual(ids(sortPlayers(list, opt('QB', 'int'), summaries)), ['b', 'nostats']);
});

test('with no stats at all, every stat sort degrades to ADP order', () => {
  const list = [P('c', 30), P('a', 10), P('b', 20)];
  assert.deepEqual(ids(sortPlayers(list, opt('WR', 'rec'), {})), ['a', 'b', 'c']);
});

test('ADP breaks ties, so equal lines never jitter', () => {
  const list = [P('late', 90), P('early', 3)];
  const summaries = { late: sum({ rec: 50 }), early: sum({ rec: 50 }) };
  assert.deepEqual(ids(sortPlayers(list, opt('WR', 'rec'), summaries)), ['early', 'late']);
});

test('the default sort is ADP ascending and ignores summaries', () => {
  const list = [P('c', 30), P('a', 10)];
  assert.deepEqual(ids(sortPlayers(list, opt('ALL', 'adp'), {})), ['a', 'c']);
});

test('RB TD sort combines rushing and receiving scores', () => {
  const list = [P('a', 10), P('b', 20)];
  const summaries = { a: sum({ rushTd: 2, recTd: 1 }), b: sum({ rushTd: 0, recTd: 5 }) };
  assert.deepEqual(ids(sortPlayers(list, opt('RB', 'td'), summaries)), ['b', 'a']);
});

test('sortPlayers does not mutate the caller list', () => {
  const list = [P('c', 30), P('a', 10)];
  sortPlayers(list, opt('ALL', 'adp'), {});
  assert.deepEqual(ids(list), ['c', 'a']);
});

test('a missing/unknown option falls back to ADP rather than throwing', () => {
  const list = [P('c', 30), P('a', 10)];
  assert.deepEqual(ids(sortPlayers(list, undefined, {})), ['a', 'c']);
});
