// lib/rankings/composite.test.mjs - the two functions that turn dimensions
// into the number a reader sees, and neither had a test.
//
// computeEditorialComposite (teamPowerScorer.js:324) is the INNER mean; it is
// the one place that decides what "scored 2 of 5 dimensions" is worth.
// composeOuterScores (editionRunner.js:284) is the OUTER blend; it is the one
// place that decides what happens when there is no sites layer to blend with.
//
// THE OUTER FALLBACK IS THE REASON THIS FILE MATTERS. When sites_composite is
// null, the formula does NOT multiply editorial by its weight and hand back a
// smaller number - it drops the blend entirely and returns editorial at full
// strength. The weights redistribute onto editorial. Written as a formula that
// is the difference between 8.0 and 5.6 on a board where 2.4 is most of the
// field's spread, and NOTHING anywhere asserted which one it is. A gridiron
// edition hits this path on every team the AP does not rank, which on the CFB
// board is most of them, so it is now pinned by its VALUE and not by its shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeEditorialComposite } from './teamPowerScorer.js';
import { composeOuterScores } from './editionRunner.js';

// ------------------------------------------------- the inner mean

test('computeEditorialComposite OVER 2 OF 5 DIMS averages the two, not the five', () => {
  // The model holds the dims it cannot honestly score. A composite that
  // divided by five would silently punish a team for a dimension nobody
  // scored, which is the opposite of holding it.
  const parsed = {
    dims: { result: 8, process: 6, squad: null, coherence: null, momentum: null },
    scored_dims: ['result', 'process'],
    held_dims: ['squad', 'coherence', 'momentum'],
  };
  assert.equal(computeEditorialComposite(parsed), 7, '(8 + 6) / 2');
  // Divide-by-five would have produced 2.8. Named so the intent cannot drift.
  assert.notEqual(computeEditorialComposite(parsed), 2.8);
});

test('computeEditorialComposite: five of five, one of five, and none at all', () => {
  assert.equal(computeEditorialComposite({
    dims: { a: 9, b: 8, c: 7, d: 6, e: 5 }, scored_dims: ['a', 'b', 'c', 'd', 'e'],
  }), 7);
  assert.equal(computeEditorialComposite({ dims: { a: 6.4 }, scored_dims: ['a'] }), 6.4);
  // NO SCORED DIM IS NULL, NOT ZERO. A team the model declined to score must
  // not arrive on the board at the bottom; it must not arrive at all.
  assert.equal(computeEditorialComposite({ dims: {}, scored_dims: [] }), null);
  assert.equal(computeEditorialComposite({ dims: { a: 5 }, scored_dims: [] }), null);
  // A dim NAMED as scored but holding a non-number is dropped from the mean.
  assert.equal(computeEditorialComposite({ dims: { a: 8, b: null }, scored_dims: ['a', 'b'] }), 8);
  assert.equal(computeEditorialComposite({ dims: { a: null }, scored_dims: ['a'] }), null);
  // One decimal place, always - the composite is a display number.
  assert.equal(computeEditorialComposite({ dims: { a: 8, b: 7, c: 7 }, scored_dims: ['a', 'b', 'c'] }), 7.3);
});

// ------------------------------------------------- the outer blend

const entry = (teamId, editorial, extra = {}) => ({
  ok: true, teamId, team_name: `T${teamId}`, editorial_composite: editorial,
  parsed: { dims: { result: editorial }, scored_dims: ['result'], held_dims: [], justifications: {}, reasoning: '' },
  ...extra,
});

test('SITES PRESENT: the blend is exactly editorial*w + sites*w', () => {
  const [row] = composeOuterScores({
    scorerResults: [entry(1, 8)],
    sitesMap: new Map([[1, { sites_composite: 6 }]]),
    editorial_weight: 0.7, sites_weight: 0.3,
  });
  assert.equal(row.score, 7.4, '0.7*8 + 0.3*6');
  assert.equal(row.editorial_composite, 8, 'the inner number is carried through unchanged');
  assert.deepEqual(row.sites, { sites_composite: 6 });
});

test('SITES NULL: THE WEIGHTS REDISTRIBUTE ONTO EDITORIAL - the number, not the shape', () => {
  // THE ASSERTION THIS FILE WAS WRITTEN FOR. Same editorial, same weights, no
  // sites row. If the formula multiplied through it would be 5.6.
  const [row] = composeOuterScores({
    scorerResults: [entry(1, 8)],
    sitesMap: new Map(),
    editorial_weight: 0.7, sites_weight: 0.3,
  });
  assert.equal(row.score, 8, 'editorial at FULL strength, not 0.7 of it');
  assert.notEqual(row.score, 5.6, 'the weight is not applied to a blend that is not happening');
  assert.equal(row.sites, null, 'and the row says openly that there was no sites layer');
  // A sites ROW that exists but carries a null composite takes the same path -
  // present-but-empty and absent must not disagree.
  const [row2] = composeOuterScores({
    scorerResults: [entry(2, 8)],
    sitesMap: new Map([[2, { sites_composite: null }]]),
    editorial_weight: 0.7, sites_weight: 0.3,
  });
  assert.equal(row2.score, 8);
});

test('A MIXED FIELD SORTS BY THE OUTER SCORE, and the unranked team is not punished for it', () => {
  // The CFB shape: one AP-ranked team with a sites score, two without. The
  // fallback means an unranked team with a strong editorial read can and does
  // outrank a ranked one with a weak sites number - which is the intended
  // behaviour, and is worth seeing written down before it surprises somebody.
  const composed = composeOuterScores({
    scorerResults: [entry(1, 7), entry(2, 8), entry(3, 6.5)],
    sitesMap: new Map([[1, { sites_composite: 10 }]]),
    editorial_weight: 0.7, sites_weight: 0.3,
  });
  assert.deepEqual(composed.map((r) => [r.teamId, r.score]), [[1, 7.9], [2, 8], [3, 6.5]].sort((a, b) => b[1] - a[1]));
  assert.deepEqual(composed.map((r) => r.teamId), [2, 1, 3], 'sorted desc by outer score');
});

test('A RESULT THAT IS NOT OK, OR HAS NO COMPOSITE, NEVER REACHES THE BOARD', () => {
  const composed = composeOuterScores({
    scorerResults: [
      entry(1, 8),
      { ok: false, teamId: 2, editorial_composite: 9 },
      { ok: true, teamId: 3, editorial_composite: null, parsed: { dims: {}, scored_dims: [] } },
    ],
    sitesMap: new Map(), editorial_weight: 1, sites_weight: 0,
  });
  assert.deepEqual(composed.map((r) => r.teamId), [1], 'a failed score is absent, not a zero at the bottom');
});
