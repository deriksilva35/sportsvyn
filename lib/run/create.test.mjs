// lib/run/create.test.mjs - the board a round freezes, and the byes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardFor } from './create.js';

const S = (key, stage, a, b, winner, games) => ({
  key, stage, bestOf: stage === 'wild_card' ? 3 : 5, winner,
  teams: [
    { id: a[0], abbreviation: a[1], name: a[1], colors: { primary: '#1', secondary: '#2' } },
    { id: b[0], abbreviation: b[1], name: b[1], colors: null },
  ],
  games,
});
const g = (id, iso, status = 'scheduled') => ({ id, slug: `g${id}`, kickoffAt: iso, status });

const SEEDS = new Map([['1', 3], ['2', 6], ['3', 4], ['4', 5], ['5', 1], ['6', 2], ['7', 1]]);
const WC = [
  S('wild_card:CHW-TB', 'wild_card', [1, 'TB'], [2, 'CHW'], null,
    [g(101, '2026-09-29T17:05:00Z'), g(102, '2026-09-30T17:05:00Z')]),
  S('wild_card:BOS-NYY', 'wild_card', [3, 'NYY'], [4, 'BOS'], null,
    [g(103, '2026-09-29T14:05:00Z'), g(104, '2026-09-30T14:05:00Z')]),
];
const BYES = [
  { teamId: 5, abbr: 'TEX', name: 'Rangers', seed: 1, colors: null },
  { teamId: 6, abbr: 'CLE', name: 'Guardians', seed: 2, colors: null },
];

test('THE BOARD FREEZES THE ROUND: clubs, match ids and the first pitch', () => {
  const b = boardFor({ round: 'wild_card', series: WC, byeClubs: BYES, seeds: SEEDS });
  // THE BOARD IS AN ARRAY OF CLUBS, and everything else is meta - because
  // contests.board is an array for every game in this product, and at least
  // one existing query calls jsonb_array_length on it without asking which
  // game it belongs to. Storing an object there broke that query the first
  // time a Run contest existed.
  assert.ok(Array.isArray(b.clubs));
  assert.equal(b.meta.round, 'wild_card');
  assert.equal(b.meta.label, 'Wild Card');
  assert.equal(b.meta.seriesCount, 2);
  // Every game of every series, deduplicated - the round's whole box score.
  assert.deepEqual([...b.meta.matchIds].sort((x, y) => x - y), [101, 102, 103, 104]);
  // THE ROUND LOCKS AT ITS EARLIEST FIRST PITCH, across all its series - not
  // at the first game of the first series in the list.
  assert.equal(b.meta.firstPitch, '2026-09-29T14:05:00.000Z');
  // Each club carries its opponent and the series length, which is what the
  // mock's grid prints under the abbreviation.
  const tb = b.clubs.find((c) => c.abbr === 'TB');
  assert.equal(tb.opponent, 'CHW');
  assert.equal(tb.bestOf, 3);
  assert.equal(tb.bye, false);
  // THE SEED IS ON EVERY CLUB, not just the ones waiting: the grid prints
  // "3 · vs CHW" under a playing club, and a blank there is a hole.
  assert.equal(tb.seed, 3);
  assert.deepEqual(tb.colors, { primary: '#1', secondary: '#2' });
});

test('BYE CLUBS ARE ON THE BOARD AND MARKED, not omitted', () => {
  // The mock draws them dimmed with a corner label, because the reader has to
  // be able to see who is waiting for them in the next round.
  const b = boardFor({ round: 'wild_card', series: WC, byeClubs: BYES, seeds: SEEDS });
  assert.equal(b.clubs.length, 6, 'four playing, two on a bye');
  const byes = b.clubs.filter((c) => c.bye);
  assert.deepEqual(byes.map((c) => c.abbr).sort(), ['CLE', 'TEX']);
  // A bye club has no opponent and no series - that is what a bye IS.
  assert.ok(byes.every((c) => c.opponent === null && c.seriesKey === null && c.bestOf === null));
  // Sorted by abbreviation within the bye group, so CLE (2) precedes TEX (1).
  assert.deepEqual(byes.map((c) => c.seed).sort(), [1, 2]);
  // AND THEY SORT LAST, after every club that is actually playing.
  assert.deepEqual(b.clubs.map((c) => c.bye), [false, false, false, false, true, true]);
});

test('IN EVERY LATER ROUND THERE ARE NO BYES AT ALL', () => {
  // The bye is a round-1 fact. A Division board is built with no bye clubs,
  // so the flag is false on every entry and the rule that reads it is inert -
  // the reader never has to ask which rule is in force.
  const div = boardFor({
    round: 'division',
    series: [S('division:NYY-TOR', 'division', [3, 'NYY'], [7, 'TOR'], null, [g(201, '2026-10-04T18:08:00Z')])],
    byeClubs: [],
  });
  assert.equal(div.clubs.length, 2);
  assert.ok(div.clubs.every((c) => c.bye === false));
  assert.equal(div.meta.label, 'Division');
  assert.equal(div.meta.firstPitch, '2026-10-04T18:08:00.000Z');
});

test('A ROUND WITH NO GAMES HAS NO FIRST PITCH, and cannot be opened', () => {
  const empty = boardFor({ round: 'world_series', series: [], byeClubs: [] });
  assert.equal(empty.meta.firstPitch, null);
  assert.deepEqual(empty.clubs, []);
  assert.deepEqual(empty.meta.matchIds, []);
});
