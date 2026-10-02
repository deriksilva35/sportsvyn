// lib/six/score.test.mjs - a card against the box, the perfect six, ranks. Pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCard, perfectSix, seatable, rankScores, rankable } from './score.js';
import { settleGate, playedLines } from './settle.js';

const box = (matchId, id, o) => [`${matchId}:${id}`, { match_id: matchId, bdl_player_id: String(id), dnp: false, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, turnovers: 0, fg3m: 0, ...o }];
const pick = (id, matchId) => ({ playerId: String(id), matchId });

test('per slot: final scores, live scores, pending waits, DNP is 0, void is 0, empty is empty', () => {
  const statBy = new Map([
    box(1, 10, { pts: 30, reb: 10 }), // final, DD: 30 + 12.5 + 1.5
    box(1, 11, { dnp: true, pts: null }), // final, DNP row
    box(2, 20, { pts: 8 }), // live
  ]);
  const matchBy = new Map([['1', { status: 'final' }], ['2', { status: 'live' }], ['3', { status: 'scheduled' }], ['4', { status: 'postponed' }]]);
  const card = scoreCard({
    g1: pick(10, 1), g2: pick(11, 1), f1: pick(12, 1) /* final, no row at all */, f2: pick(20, 2), c: pick(30, 3), util: pick(40, 4),
  }, statBy, matchBy);
  const by = Object.fromEntries(card.slots.map((s) => [s.slot, s]));
  assert.deepEqual([by.g1.state, by.g1.points, by.g1.dnp], ['final', 44, false]);
  assert.deepEqual([by.g2.state, by.g2.points, by.g2.dnp, by.g2.line], ['final', 0, true, 'DNP'], 'a DNP row is 0, not a DNF');
  assert.deepEqual([by.f1.state, by.f1.points, by.f1.dnp], ['final', 0, true], 'no row in a final is a DNP too');
  assert.deepEqual([by.f2.state, by.f2.points], ['live', 8]);
  assert.deepEqual([by.c.state, by.c.points], ['pending', null]);
  assert.deepEqual([by.util.state, by.util.points], ['void', 0]);
  assert.equal(card.total, 52);
  assert.equal(card.complete, false);
  assert.ok(by.g1.chips.some((c) => c.key === 'dd'));
  assert.equal(scoreCard({}, statBy, matchBy).slots[0].state, 'empty');
});

test('seatable: the six slots by position', () => {
  const p = (pos) => ({ position: pos });
  assert.ok(seatable([p('G'), p('G'), p('F'), p('F'), p('C'), p('G')]));
  assert.equal(seatable([p('G'), p('G'), p('G'), p('G')]), null, 'four guards need three guard-eligible slots');
  assert.ok(seatable([p('G'), p('G'), p('G-F'), p('F'), p('C'), p('F-C')]));
  assert.equal(seatable([p('C'), p('C'), p('C')]), null);
});

test('the perfect six: best legal card, positions seated, the team cap held', () => {
  const pl = (id, position, teamId, points) => ({ playerId: String(id), name: `P${id}`, position, teamId, matchId: 1, points });
  const players = [
    pl(1, 'C', 1, 60), pl(2, 'C', 1, 55), pl(3, 'C', 1, 50), // three big centers, one team
    pl(4, 'G', 2, 40), pl(5, 'G', 2, 39), pl(6, 'F', 3, 30), pl(7, 'F', 3, 29), pl(8, 'G', 4, 20), pl(9, 'F', 4, 10),
  ];
  const best = perfectSix(players, { cap: 2 });
  // Two centers max (cap 2, team 1): C 60 in c, C 55 in util. Guards 40, 39. Forwards 30, 29.
  assert.equal(best.total, 253);
  assert.deepEqual(best.picks.map((x) => [x.slot, x.playerId]), [['g1', '4'], ['g2', '5'], ['f1', '6'], ['f2', '7'], ['c', '1'], ['util', '2']]);
  // Cap 3 (a one-game night) lets the third center in? Not without a slot: only c and util take a C.
  assert.equal(perfectSix(players, { cap: 3 }).total, 253);
  assert.equal(perfectSix(players.slice(0, 3), { cap: 2 }), null, 'no legal six');
});

test('ranks share ties; a card with nobody on it does not rank', () => {
  const r = rankScores([{ points: 50 }, { points: 61.5 }, { points: 50 }, { points: 0 }]);
  assert.deepEqual(r.map((x) => x.rank), [2, 1, 2, 4], 'a filled card that scored 0 ranks');
  assert.equal(rankable(0), false); assert.equal(rankable(1), true);
});

test('THE SETTLE GATE: every game final or void, and every final boxed', () => {
  const board = [{ match_id: 1, slug: 'a' }, { match_id: 2, slug: 'b' }, { match_id: 3, slug: 'c' }];
  const statBy = new Map([box(1, 10, { pts: 5 })]);
  let byId = new Map([['1', { status: 'final' }], ['2', { status: 'live' }], ['3', { status: 'postponed' }]]);
  let g = settleGate(board, byId, statBy);
  assert.equal(g.ready, false);
  assert.deepEqual(g.waitingOn.map((w) => [w.matchId, w.why]), [[2, 'not_final']]);
  assert.deepEqual(g.voided, [3]);
  byId = new Map([['1', { status: 'final' }], ['2', { status: 'final' }], ['3', { status: 'postponed' }]]);
  g = settleGate(board, byId, statBy);
  assert.deepEqual(g.waitingOn.map((w) => [w.matchId, w.why]), [[2, 'no_box']], 'final without its box is refused');
  g = settleGate(board, byId, new Map([...statBy, box(2, 20, { pts: 3 })]));
  assert.equal(g.ready, true);
  // playedLines: only finals, never a DNP.
  const lines = playedLines(new Map([box(1, 10, { pts: 5, team_id: 7, position: 'G' }), box(1, 11, { dnp: true })]), byId);
  assert.deepEqual(lines.map((l) => [l.playerId, l.points]), [['10', 5]]);
});
