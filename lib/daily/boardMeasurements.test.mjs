// lib/daily/boardMeasurements.test.mjs — the measurement machinery itself,
// proven correct on hand-worked cases before it is ever pointed at real
// season data (that run lives in the verification script, not here).
//
// GREEDY IS MEASURED IN TEAM ORDER (ruling) - a board forces one pick per
// team, it never asks anyone to fill slots in some order.

import test from 'node:test';
import assert from 'node:assert/strict';
import { greedyByTeamOrder, measureBoard } from './boardMeasurements.js';
import { makeRng } from './pool.js';

const team = (key, card) => ({ key, card });

// -----------------------------------------------------------------------
// THE HAND-WORKED CASE, IN TEAM-ORDER SPACE. Two teams, two slots (X, Y).
//   T1: X=10, Y=9      T2: X=8, Y=1
// Team-order [T1, T2]: open T1 first - its single best player overall is
//   the X-eligible one (10 > 9), so it fills X with 10. Open T2 next - X is
//   taken, so only T2's Y-eligible player (1) is still legal: fills Y.
//   Total 10 + 1 = 11.
// Team-order [T2, T1]: open T2 first - best overall is its X-eligible
//   player (8 > 1), fills X with 8. Open T1 next - X is taken, so only
//   T1's Y-eligible player (9) is legal: fills Y. Total 8 + 9 = 17 - the
//   TRUE optimum (same hand-computed optimum as assignmentSolver.test.mjs:
//   X->T2, Y->T1 = 8+9=17 beats X->T1, Y->T2 = 10+1=11).
// -----------------------------------------------------------------------
const TRAP_TEAMS = [
  team('T1', [{ position: 'X', points: 10 }, { position: 'Y', points: 9 }]),
  team('T2', [{ position: 'X', points: 8 }, { position: 'Y', points: 1 }]),
];

test('greedyByTeamOrder: [T1,T2] reaches 11 (hand-worked), [T2,T1] reaches the true optimum 17', () => {
  assert.equal(greedyByTeamOrder(TRAP_TEAMS, ['T1', 'T2'], ['X', 'Y']).total, 11);
  assert.equal(greedyByTeamOrder(TRAP_TEAMS, ['T2', 'T1'], ['X', 'Y']).total, 17);
});

test('greedyByTeamOrder places the team\'s BEST player, not its first eligible one', () => {
  const teams = [team('A', [{ position: 'RB', points: 3 }, { position: 'RB', points: 9 }])];
  const res = greedyByTeamOrder(teams, ['A'], ['RB']);
  assert.equal(res.total, 9, 'the better of A\'s two RB-eligible players is the one used');
});

test('a team whose whole card fits nothing still open contributes nothing and is skipped', () => {
  const teams = [
    team('A', [{ position: 'X', points: 5 }]), // X will already be filled
    team('B', [{ position: 'X', points: 1 }]), // B has NOTHING for the only other slot, Y
    team('C', [{ position: 'Y', points: 3 }]),
  ];
  const res = greedyByTeamOrder(teams, ['A', 'B', 'C'], ['X', 'Y']);
  assert.equal(res.ok, true);
  assert.equal(res.total, 5 + 3, 'B is opened, finds nothing legal, contributes zero, and play moves on to C');
});

test('greedyByTeamOrder refuses (ok:false) when the teams run out before every slot is filled', () => {
  const teams = [team('A', [{ position: 'X', points: 5 }])];
  const res = greedyByTeamOrder(teams, ['A'], ['X', 'Y']);
  assert.equal(res.ok, false);
});

test('measureBoard, on the trap: best=100% (the [T2,T1] order), worst matches the hand-computed 11/17', () => {
  // Only two team orders exist - trials beyond 2 just resample them, which
  // is fine; the point is both possible outcomes get observed.
  const res = measureBoard(TRAP_TEAMS, makeRng('seed-1'), { trials: 40, slots: ['X', 'Y'] });
  assert.equal(res.ok, true);
  assert.equal(res.optimum, 17);
  assert.ok(res.greedy.everHit100, 'the [T2,T1] order exists and must be sampled at least once in 40 tries');
  const expectedWorstPct = (11 / 17) * 100;
  assert.ok(Math.abs(res.greedy.worst - expectedWorstPct) < 0.01,
    `worst should be the hand-computed ${expectedWorstPct.toFixed(2)}%, got ${res.greedy.worst}`);
  assert.ok(res.greedy.best >= res.greedy.average);
  assert.ok(res.greedy.average >= res.greedy.worst);
});

test('teamUniqueOk is true on a well-formed feasible board - the ceiling never repeats a team', () => {
  const teams = Array.from({ length: 12 }, (_, i) => team(`T${i}`, [
    { position: 'QB', points: 10 + i }, { position: 'RB', points: 8 + i },
    { position: 'WR', points: 6 + i }, { position: 'TE', points: 4 + i }, { position: 'PK', points: i },
  ]));
  const res = measureBoard(teams, makeRng('seed-2'), { trials: 25 });
  assert.equal(res.ok, true);
  assert.equal(res.teamUniqueOk, true);
});

test('an infeasible board (no QB anywhere) reports ok:false with the solver\'s reason - no measurement of the unmeasurable', () => {
  const teams = Array.from({ length: 12 }, (_, i) => team(`T${i}`, [
    { position: 'RB', points: 8 }, { position: 'WR', points: 6 }, { position: 'TE', points: 4 }, { position: 'PK', points: 3 },
  ]));
  const res = measureBoard(teams, makeRng('seed-3'));
  assert.equal(res.ok, false);
  assert.ok(res.reason);
});

test('every sampled greedy percentage is bounded by (0, 100] - never negative, never past the ceiling', () => {
  const teams = Array.from({ length: 12 }, (_, i) => team(`T${i}`, [
    { position: 'QB', points: 5 + (i % 4) }, { position: 'RB', points: 3 + (i % 5) },
    { position: 'WR', points: 2 + (i % 3) }, { position: 'TE', points: 1 + (i % 2) }, { position: 'PK', points: 1 },
  ]));
  const res = measureBoard(teams, makeRng('seed-4'), { trials: 60 });
  assert.equal(res.ok, true);
  assert.ok(res.greedy.worst > 0 && res.greedy.best <= 100.0001);
});
