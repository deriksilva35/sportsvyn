// lib/pickem/readerV2.test.mjs - the three facts the v2 board needs that the
// reader did not carry: the live clock, the network, and the season line.
// PURE: gameRows() takes maps, mySeason() takes pickemTable()'s own output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameRows } from './view.js';
import { mySeason, avgOf } from './seasonPct.js';

const KICK = '2026-09-20T17:00:00.000Z';
const BOARD = [
  { match_id: 1, slug: 'a-at-b', kickoff_at: KICK, home: 'BUF', away: 'DET', home_team_id: 10, away_team_id: 20 },
  { match_id: 2, slug: 'c-at-d', kickoff_at: KICK, home: 'CIN', away: 'TB', home_team_id: 30, away_team_id: 40 },
];
const rowsFor = (liveById, networks = new Map(), now = '2026-09-20T18:00:00.000Z') =>
  gameRows({ board: BOARD, liveById, networks, now, picks: {} });

// ---------------------------------------------------------------------------
// THE LIVE CLOCK
// ---------------------------------------------------------------------------

test('a LIVE game carries the period as a LABEL and the clock as written', () => {
  // live_state.period is an INTEGER in this database; the row must not print 3.
  const [g] = rowsFor(new Map([[1, { status: 'live', home_score: 21, away_score: 10, live_state: { period: 3, clock: '7:28' } }]]));
  assert.equal(g.period, 'Q3');
  assert.equal(g.clock, '7:28');
});

test('overtime and halftime read as the scoreboard reads them', () => {
  const ot = rowsFor(new Map([[1, { status: 'live', live_state: { period: 5, clock: '4:20' } }]]))[0];
  assert.equal(ot.period, 'OT');
  const ht = rowsFor(new Map([[1, { status: 'live', live_state: { period: 2, clock: '0:00' } }]]))[0];
  assert.equal(ht.period, 'HT');
});

test('A SCHEDULED OR FINAL GAME HAS NO CLOCK AT ALL', () => {
  // A period beside a final score is a number that stopped being true - the
  // same rule the line already follows.
  const sched = rowsFor(new Map([[1, { status: 'scheduled' }]]))[0];
  assert.equal(sched.period, null);
  assert.equal(sched.clock, null);
  const fin = rowsFor(new Map([[1, { status: 'final', home_score: 31, away_score: 24, live_state: { period: 4, clock: '0:00' } }]]))[0];
  assert.equal(fin.period, null, 'a final keeps its score and drops its clock');
  assert.equal(fin.clock, null);
  assert.equal(fin.home_score, 31);
});

test('a live game the poller has not clocked yet is live with no clock, not a lie', () => {
  const [g] = rowsFor(new Map([[1, { status: 'live', home_score: 0, away_score: 0, live_state: null }]]));
  assert.equal(g.status, 'live');
  assert.equal(g.period, null);
  assert.equal(g.clock, null);
});

// ---------------------------------------------------------------------------
// THE NETWORK
// ---------------------------------------------------------------------------

test('the primary broadcaster rides the row', () => {
  const rows = rowsFor(new Map(), new Map([[1, 'FOX'], [2, 'Prime Video']]));
  assert.equal(rows[0].network, 'FOX');
  assert.equal(rows[1].network, 'Prime Video');
});

test('NO BROADCASTER ROW IS null - never a dash, and never invented', () => {
  const rows = rowsFor(new Map(), new Map([[1, 'FOX']]));
  assert.equal(rows[1].network, null);
  // And a board read with no network map at all still renders.
  assert.equal(gameRows({ board: BOARD, picks: {} })[0].network, null);
});

// ---------------------------------------------------------------------------
// THE SEASON LINE
// ---------------------------------------------------------------------------

const TABLE = {
  top: [
    { userId: 7, correct: 20, played: 30, pct: 66.7 },
    { userId: 8, correct: 12, played: 30, pct: 40 },
  ],
  self: { userId: 99, correct: 2, played: 3, pct: 66.7 },
};

test('A READER INSIDE THE TOP IS FOUND IN `top`, not only in `self`', () => {
  // pickemTable populates `self` ONLY for a reader outside the top N. Reading
  // `self` alone would show a season line to everyone except the leaders.
  assert.deepEqual(mySeason(TABLE, 7), { correct: 20, played: 30, avg: '.667' });
});

test('a reader outside the top is found in `self`', () => {
  assert.deepEqual(mySeason(TABLE, 99), { correct: 2, played: 3, avg: '.667' });
});

test('no table, no id, or no resolved game means NO LINE - not a zero', () => {
  assert.equal(mySeason(null, 7), null);
  assert.equal(mySeason(TABLE, null), null);
  assert.equal(mySeason(TABLE, 1234), null, 'a reader with no settled board');
  assert.equal(mySeason({ top: [{ userId: 7, correct: 0, played: 0 }] }, 7), null);
});

test('the average is the mock\'s three decimals, with the leading zero dropped', () => {
  assert.equal(avgOf(2, 3), '.667');
  assert.equal(avgOf(1, 3), '.333');
  assert.equal(avgOf(0, 5), '.000');
  assert.equal(avgOf(5, 5), '1.000');
  assert.equal(avgOf(0, 0), null);
});
