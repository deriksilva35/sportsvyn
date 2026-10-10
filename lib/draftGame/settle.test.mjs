// lib/draftGame/settle.test.mjs - per-game Draft scoring, pure (fri-1 S2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSeat, places, topPercent, roomResult, isVoidGame } from './settle.js';
import { advanceBots, completeRoom } from './rules.js';
import { phaseOf } from './room.js';

// A receiving line worth `pts` PPR: rec r and yards so 1*r + yds/10 = pts.
const rx = (pts) => ({ rec: 0, rec_yds: Math.round(pts * 10) });
const P = (id, n, pos = 'WR') => ({ id, n, name: `P${id}`, pos, team: 'AAA' });

test('a seat scores its best three', () => {
  const stats = new Map([[1, rx(20)], [2, rx(5)], [3, rx(12)], [4, rx(9)]]);
  const r = scoreSeat([P(1, 1), P(2, 5), P(3, 9), P(4, 13)], stats);
  assert.equal(r.score, 41);
  assert.deepEqual(r.players.filter((p) => !p.counted).map((p) => p.id), [2]);
});

test('a player who does not play scores 0, is marked so, and is the one not counted', () => {
  const stats = new Map([[1, rx(20)], [3, rx(12)], [4, rx(9)]]);
  const r = scoreSeat([P(1, 1), P(2, 5), P(3, 9), P(4, 13)], stats);
  const dnp = r.players.find((p) => p.id === 2);
  assert.equal(dnp.played, false);
  assert.equal(dnp.pts, 0);
  assert.equal(dnp.counted, false);
  assert.equal(r.score, 41);
  // Two no-shows: the second one counts, at 0.
  const two = scoreSeat([P(1, 1), P(2, 5), P(3, 9), P(4, 13)], new Map([[1, rx(20)], [3, rx(12)]]));
  assert.equal(two.score, 32);
  assert.equal(two.players.filter((p) => p.counted).length, 3);
});

test('a tie at the 3rd/4th line counts the EARLIER pick', () => {
  const stats = new Map([[1, rx(20)], [2, rx(10)], [3, rx(7)], [4, rx(7)]]);
  const r = scoreSeat([P(1, 1), P(2, 5), P(4, 13), P(3, 9)], stats);
  assert.equal(r.players.find((p) => p.id === 3).counted, true, 'pick 9 beats pick 13 on equal points');
  assert.equal(r.players.find((p) => p.id === 4).counted, false);
  assert.equal(r.score, 37);
});

test('places: equal scores share the higher place', () => {
  const pl = places([{ key: 1, score: 30 }, { key: 2, score: 41.2 }, { key: 3, score: 41.2 }, { key: 4, score: 10 }]);
  assert.deepEqual([pl.get(2), pl.get(3), pl.get(1), pl.get(4)], [1, 1, 3, 4]);
});

test('top percent of everyone who drafted the game', () => {
  assert.equal(topPercent(50, [50, 40, 30, 20]), 25);
  assert.equal(topPercent(20, [50, 40, 30, 20]), 100);
  assert.equal(topPercent(40, [50, 40, 40, 20]), 50, 'a tie shares the better rank');
  assert.equal(topPercent(10, [10]), 100);
  assert.equal(topPercent(99, Array(1000).fill(1).concat([99])), 1, 'never 0%');
});

test('a whole room: four seats, places, you', () => {
  const board = Array.from({ length: 20 }, (_, i) => ({ id: 100 + i, name: `B${i}`, pos: 'RB', team: 'AAA', proj: 20 - i }));
  const picks = [...advanceBots(board, [], { contestId: 9, userSeat: 2 })];
  picks.push(...completeRoom(board, picks, { contestId: 9, userSeat: 2 }));
  const stats = new Map(board.map((b, i) => [b.id, rx(i % 7)]));
  const r = roomResult(board, picks, 2, stats);
  assert.equal(r.seats.length, 4);
  assert.deepEqual(r.seats.map((s) => s.label), ['Bot A', 'You', 'Bot B', 'Bot C']);
  assert.ok(r.seats.every((s) => s.players.length === 4 && s.players.filter((p) => p.counted).length === 3));
  assert.equal(r.you.score, r.seats[1].score);
  assert.ok(r.seats.every((s) => s.place >= 1 && s.place <= 4));
});

test('void games and the page phases', () => {
  assert.equal(isVoidGame('postponed'), true);
  assert.equal(isVoidGame('final'), false);
  assert.equal(phaseOf({ room: null, locked: false }), 'pre');
  assert.equal(phaseOf({ room: {}, done: false, locked: false }), 'drafting');
  assert.equal(phaseOf({ room: {}, done: true, locked: false }), 'waiting');
  assert.equal(phaseOf({ room: {}, done: true, locked: true }), 'live');
  assert.equal(phaseOf({ room: {}, locked: true, settled: true }), 'final');
  assert.equal(phaseOf({ room: {}, locked: true, settled: true, voided: true }), 'void');
});
