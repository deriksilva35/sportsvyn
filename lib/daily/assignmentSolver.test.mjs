// lib/daily/assignmentSolver.test.mjs — Kuhn-Munkres, checked against
// hand-computed optima. A Hungarian-algorithm implementation is exactly the
// kind of code that can be subtly wrong and still pass a shallow test, so
// every case here is worked out by hand in the comment beside it, not just
// asserted against the function's own output.

import test from 'node:test';
import assert from 'node:assert/strict';
import { solveBoard, weightMatrix } from './assignmentSolver.js';

const team = (key, card) => ({ key, card });

test('weightMatrix picks the BEST eligible player per (slot, team), never the first', () => {
  const teams = [
    team('A', [{ position: 'RB', points: 3 }, { position: 'RB', points: 9 }]),
    team('B', [{ position: 'WR', points: 5 }]),
  ];
  const { weights, picks } = weightMatrix(teams, ['RB', 'WR']);
  assert.equal(weights[0][0], 9, 'team A RB slot must read its BETTER RB, 9 not 3');
  assert.equal(picks[0][0].points, 9);
  assert.equal(weights[0][1], -1000000, 'team B has no RB at all - infeasible, not zero');
  assert.equal(weights[1][1], 5);
});

// -----------------------------------------------------------------------
// THE HAND-WORKED CASE. Two teams, two slots (X, Y - arbitrary position
// strings; eligibleForSlot() only special-cases 'FLEX', so a plain string
// match works for a minimal proof).
//   T1: X=10, Y=9      T2: X=8, Y=1
// Greedy filling X FIRST picks T1 for X (10 > 8), leaving T2 for Y (1):
//   total 11.
// Greedy filling Y FIRST picks T1 for Y (9 > 1), leaving T2 for X (8):
//   total 17 - the TRUE optimum, reached only because the fill order
//   happened to protect T2's one strength.
// Hand-computed optimum, by exhausting both perfect matchings (2 teams, 2
// slots - only two exist):
//   X->T1, Y->T2 = 10 + 1  = 11
//   X->T2, Y->T1 = 8  + 9  = 17   <- higher
// The solver must find 17, matching the SECOND matching, regardless of any
// fill order - this is the whole reason an exact solver exists instead of
// trusting whichever order a greedy pass happens to run in.
// -----------------------------------------------------------------------
test('the solver finds the true optimum a naive X-first greedy fill would miss', () => {
  const teams = [
    team('T1', [{ position: 'X', points: 10 }, { position: 'Y', points: 9 }]),
    team('T2', [{ position: 'X', points: 8 }, { position: 'Y', points: 1 }]),
  ];
  const res = solveBoard(teams, ['X', 'Y']);
  assert.equal(res.ok, true);
  assert.equal(res.total, 17, 'the optimum is 17 (T2->X, T1->Y), not 11 (T1->X, T2->Y)');
  const bySlot = Object.fromEntries(res.bySlot.map((b) => [b.slot, b.teamKey]));
  assert.equal(bySlot.X, 'T2');
  assert.equal(bySlot.Y, 'T1');
});

test('a rectangular case (more teams than slots) still finds the true optimum', () => {
  // Three teams competing for two slots. By hand: the best pairing pins
  // T3 to Y (its only real value, 12) and lets X go to whichever of T1/T2
  // scores higher there (T1, 7) - total 19. Any pairing that wastes T3's
  // 12 on X instead scores at most 8 (T3 X) + 6 (T2 Y, the next-best Y) = 14.
  const teams = [
    team('T1', [{ position: 'X', points: 7 }, { position: 'Y', points: 2 }]),
    team('T2', [{ position: 'X', points: 5 }, { position: 'Y', points: 6 }]),
    team('T3', [{ position: 'X', points: 8 }, { position: 'Y', points: 12 }]),
  ];
  const res = solveBoard(teams, ['X', 'Y']);
  assert.equal(res.ok, true);
  assert.equal(res.total, 19);
  const bySlot = Object.fromEntries(res.bySlot.map((b) => [b.slot, b.teamKey]));
  assert.equal(bySlot.Y, 'T3', 'T3\'s real strength (Y=12) must not be wasted on X');
  assert.equal(bySlot.X, 'T1', 'X goes to the best team NOT already pinned to Y');
});

test('teamsUsed is exactly one entry per slot, always distinct - the ceiling uses each team once', () => {
  const teams = Array.from({ length: 12 }, (_, i) => team(`T${i}`, [
    { position: 'QB', points: 10 + i }, { position: 'RB', points: 5 + i },
    { position: 'WR', points: 4 + i }, { position: 'TE', points: 3 + i }, { position: 'PK', points: i },
  ]));
  const res = solveBoard(teams);
  assert.equal(res.ok, true);
  assert.equal(res.teamsUsed.length, 8, 'exactly one team per slot');
  assert.equal(new Set(res.teamsUsed).size, 8, 'no team supplies two slots');
});

test('a slot no drawn team can fill makes the whole board infeasible - refused, not partial', () => {
  // QB has no fallback (unlike RB/WR/TE, which FLEX absorbs) - a draw with
  // no QB anywhere is the real infeasibility case under the current shape
  // (QB/RB/RB/WR/WR/FLEX/FLEX/K, no dedicated TE slot).
  const teams = Array.from({ length: 8 }, (_, i) => team(`T${i}`, [
    { position: 'RB', points: 8 }, { position: 'WR', points: 6 },
    { position: 'TE', points: 5 }, { position: 'PK', points: 3 },
    // NOTE: no team here carries a QB row at all.
  ]));
  const res = solveBoard(teams);
  assert.equal(res.ok, false);
  assert.equal(res.total, null);
  assert.deepEqual(res.bySlot, []);
});

test('losing the dedicated TE slot means TE-less teams still complete a board - FLEX absorbs RB/WR fine', () => {
  // Same shape as the failing case above, MINUS the missing position: every
  // team has QB/RB/WR/PK and NO team has any TE row at all. Under the old
  // TE-slotted shape this would have been infeasible; under the current
  // shape (two FLEX slots, no TE slot) it must complete, because FLEX only
  // ever needed RB/WR/TE eligibility, not TE specifically.
  const teams = Array.from({ length: 8 }, (_, i) => team(`T${i}`, [
    { position: 'QB', points: 10 + i }, { position: 'RB', points: 8 + i },
    { position: 'WR', points: 6 + i }, { position: 'PK', points: 3 },
  ]));
  const res = solveBoard(teams);
  assert.equal(res.ok, true, 'no team here has ever had a TE row, and the board still completes');
});

test('fewer teams than slots refuses immediately, before running the algorithm at all', () => {
  const teams = [team('A', [{ position: 'QB', points: 1 }])];
  const res = solveBoard(teams);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'fewer teams than slots');
});

test('FLEX reads the best RB/WR/TE across the team not already claimed by name', () => {
  const teams = [
    team('A', [{ position: 'RB', points: 20 }]),
    team('B', [{ position: 'TE', points: 15 }]),
  ];
  const { weights } = weightMatrix(teams, ['FLEX']);
  assert.equal(weights[0][0], 20);
  assert.equal(weights[0][1], 15);
});
