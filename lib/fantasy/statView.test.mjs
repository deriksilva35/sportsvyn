// lib/fantasy/statView.test.mjs - sort semantics for the available board.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sortsFor, sortPlayers, viewFor, displayPosition, teamsInPool, filterPlayers,
} from './statView.js';

const P = (id, adp) => ({ ffcPlayerId: id, adp });
const opt = (filter, key) => sortsFor(filter).find((o) => o.key === key);
const ids = (list) => list.map((p) => p.ffcPlayerId);
const sum = (totals, extra = {}) => ({ totals, points: 0, ppg: 0, games: 17, ...extra });

// ---------------------------------------------------------------------------
// display vocab (the chip label)
// ---------------------------------------------------------------------------
test('displayPosition maps FFC internals to reader labels: PK->K, DEF->DST', () => {
  assert.equal(displayPosition('PK'), 'K');
  assert.equal(displayPosition('DEF'), 'DST');
});

test('displayPosition is identity for the positions that do not differ', () => {
  for (const p of ['QB', 'RB', 'WR', 'TE']) assert.equal(displayPosition(p), p);
});

test('displayPosition passes an unknown position through unchanged', () => {
  assert.equal(displayPosition('LS'), 'LS');
  assert.equal(displayPosition(undefined), undefined);
});

// ---------------------------------------------------------------------------
// team options
// ---------------------------------------------------------------------------
test('teamsInPool is distinct, alphabetical, and drops null teams', () => {
  const list = [
    { team: 'KC' }, { team: 'DEN' }, { team: 'KC' }, { team: null }, { team: 'ATL' }, {},
  ];
  assert.deepEqual(teamsInPool(list), ['ATL', 'DEN', 'KC']);
});

test('teamsInPool([]) is empty and does not throw', () => {
  assert.deepEqual(teamsInPool([]), []);
  assert.deepEqual(teamsInPool(undefined), []);
});

// ---------------------------------------------------------------------------
// filter (position + team + search compose)
// ---------------------------------------------------------------------------
const BOARD = [
  { ffcPlayerId: 'a', name: 'Patrick Mahomes', position: 'QB', team: 'KC' },
  { ffcPlayerId: 'b', name: 'Travis Kelce', position: 'TE', team: 'KC' },
  { ffcPlayerId: 'c', name: 'Bijan Robinson', position: 'RB', team: 'ATL' },
  { ffcPlayerId: 'd', name: 'Harrison Butker', position: 'PK', team: 'KC' },
  { ffcPlayerId: 'e', name: 'Denver Defense', position: 'DEF', team: 'DEN' },
];

test('ALL/ALL with no search returns the whole board', () => {
  assert.equal(filterPlayers(BOARD, {}).length, 5);
  assert.equal(filterPlayers(BOARD, { position: 'ALL', team: 'ALL', search: '' }).length, 5);
});

test('position filter matches on DISPLAY vocab (K hits a PK, DST hits a DEF)', () => {
  assert.deepEqual(ids(filterPlayers(BOARD, { position: 'K' })), ['d']);   // PK -> K
  assert.deepEqual(ids(filterPlayers(BOARD, { position: 'DST' })), ['e']); // DEF -> DST
  assert.deepEqual(ids(filterPlayers(BOARD, { position: 'QB' })), ['a']);
});

test('team filter narrows to one team', () => {
  assert.deepEqual(ids(filterPlayers(BOARD, { team: 'KC' })), ['a', 'b', 'd']);
});

test('position and team COMPOSE: KC + TE is Chiefs tight ends only', () => {
  assert.deepEqual(ids(filterPlayers(BOARD, { position: 'TE', team: 'KC' })), ['b']);
});

test('search composes with the filters and is case-insensitive', () => {
  assert.deepEqual(ids(filterPlayers(BOARD, { team: 'KC', search: 'mah' })), ['a']);
  assert.deepEqual(ids(filterPlayers(BOARD, { search: 'DEFENSE' })), ['e']);
});

test('a team with no surviving players yields an empty board, not an error', () => {
  assert.deepEqual(filterPlayers(BOARD, { position: 'QB', team: 'DEN' }), []);
});

// ---------------------------------------------------------------------------
// the team filter must NOT enable stat sorts (gating keys off position alone)
// ---------------------------------------------------------------------------
test('sortsFor keys off position only, so a team filter never adds stat sorts', () => {
  // sortsFor takes the POSITION filter; there is no team parameter, so narrowing
  // by team cannot introduce a stat sort. ALL board => universal keys only.
  assert.deepEqual(sortsFor('ALL').map((o) => o.key), ['adp', 'ppg', 'points']);
  // and it is genuinely position that unlocks them
  assert.ok(sortsFor('WR').length > sortsFor('ALL').length);
});

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
