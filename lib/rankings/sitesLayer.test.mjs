// lib/rankings/sitesLayer.test.mjs - the curve and the blend, finally tested.
//
// THIS LAYER HAD NO TESTS AT ALL. normalizeRankToScore has shipped 21 World
// Cup editions and every number on them came out of it; sitesComposite decided
// whether a team's external ranks counted; neither had ever been asserted. The
// module's own header TABULATES the curve at N=48 (10.00 / 8.72 / 7.28 / 4.92 /
// 3.00 / 2.00) and invites the reader to "re-eyeball" after a change - that
// table is a promise no test was keeping, so a constant could have moved and
// the prose would have gone on describing the old shape.
//
// THE FIELD SIZE IS THE POINT, and it is why this file exists now. The gridiron
// boards feed it 25 (the AP poll IS a 25-team field), the World Cup feeds it 48,
// and the SAME RANK gets a different score in each: rank 10 is 5.28 in a field
// of 25 and 7.28 in a field of 48. Passing the wrong field size is the easiest
// mistake available here and the hardest to see, because both answers are
// plausible numbers in range.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRankToScore, sitesComposite, curveSamples } from './sitesLayer.js';

// ------------------------------------------------------------ the curve

test('r=1 IS THE ANCHOR at any field size: the top of the field scores exactly 10', () => {
  // headroomFraction is (N - r + 1)/N, which is 1.0 for rank 1 in any field,
  // so the exponent cannot change this and neither can the field size.
  assert.equal(normalizeRankToScore(1, 25), 10);
  assert.equal(normalizeRankToScore(1, 48), 10);
  assert.equal(normalizeRankToScore(1, 2), 10);
  assert.equal(normalizeRankToScore(1, 138), 10);
});

test('r=25 SAYS SOMETHING DIFFERENT IN EACH FIELD, and that is the whole hazard', () => {
  // LAST IN A FIELD OF 25 - one place above the floor, because the floor is
  // approached and not reached until the headroom fraction is 1/N squared.
  assert.equal(normalizeRankToScore(25, 25), 2.01);
  // MIDFIELD IN A FIELD OF 48 - the same rank, nearly double the score.
  assert.equal(normalizeRankToScore(25, 48), 4);
  // A gridiron caller that passed 48 for an AP rank would inflate every ranked
  // team by roughly two points. This is the assertion that catches it.
  assert.notEqual(normalizeRankToScore(25, 25), normalizeRankToScore(25, 48));
});

test('FIELD SIZE 25 vs 48 across the poll, with the numbers written down', () => {
  const at25 = [1, 2, 10, 13, 25].map((r) => normalizeRankToScore(r, 25));
  assert.deepEqual(at25, [10, 9.37, 5.28, 4.16, 2.01]);
  const at48 = [1, 2, 10, 13, 25].map((r) => normalizeRankToScore(r, 48));
  assert.deepEqual(at48, [10, 9.67, 7.28, 6.5, 4]);
  // Every rank scores HIGHER in the bigger field except the anchor, because a
  // rank of n leaves more of a 48-team field beneath it than of a 25-team one.
  for (let r = 2; r <= 25; r += 1) {
    assert.ok(normalizeRankToScore(r, 48) > normalizeRankToScore(r, 25), `rank ${r}`);
  }
});

test('the header table is a PROMISE, and this is the test that keeps it', () => {
  // sitesLayer.js:19-25 tabulates the N=48 curve in prose. If a constant moves,
  // the prose becomes a lie unless something compares the two.
  assert.deepEqual(curveSamples(48), [
    { rank: 1, score: 10 }, { rank: 5, score: 8.72 }, { rank: 10, score: 7.28 },
    { rank: 20, score: 4.92 }, { rank: 32, score: 3 }, { rank: 48, score: 2 },
  ]);
  // The floor is real: nothing in a valid field ever scores below it.
  for (const N of [2, 25, 48, 138]) {
    for (const r of [1, 2, Math.ceil(N / 2), N]) {
      const s = normalizeRankToScore(r, N);
      assert.ok(s >= 2 && s <= 10, `rank ${r} of ${N} scored ${s}, outside the floor/anchor band`);
    }
  }
});

test('OUT OF THE FIELD IS NO SIGNAL, never NaN and never a clamped edge value', () => {
  // A caller handing this an unranked team must get null and know it, rather
  // than a floor score that reads as "ranked last".
  assert.equal(normalizeRankToScore(0, 25), null);
  assert.equal(normalizeRankToScore(26, 25), null);
  assert.equal(normalizeRankToScore(null, 25), null);
  assert.equal(normalizeRankToScore(1, null), null);
  assert.equal(normalizeRankToScore('x', 25), null);
  assert.equal(normalizeRankToScore(1, 1), null, 'a field of one has no spread to normalise');
});

// ------------------------------------------------------------- the blend

test('sitesComposite IS NULL ON NONE - it never invents a sites layer', () => {
  // The distinction this protects: a team with no external rank must record
  // "sites layer not applied" rather than poison the outer composite with a 0.
  assert.equal(sitesComposite({}), null);
  assert.equal(sitesComposite({ fifa_score: null, espn_score: null, athletic_score: null }), null);
  assert.equal(sitesComposite({ fifa_score: undefined }), null);
  // A non-finite value is not a source either.
  assert.equal(sitesComposite({ fifa_score: NaN }), null);
  assert.equal(sitesComposite({ fifa_score: 'high' }), null);
});

test('sitesComposite is the mean over the sources PRESENT, not over three slots', () => {
  assert.equal(sitesComposite({ fifa_score: 7.5 }), 7.5, 'one source is that source verbatim');
  assert.equal(sitesComposite({ fifa_score: 7.5, espn_score: 6.5 }), 7, 'two is a 50/50');
  assert.equal(sitesComposite({ fifa_score: 9, espn_score: 6, athletic_score: 3 }), 6, 'three is equal thirds');
  // A missing source must not act as a zero - that is the bug the "sources
  // present" rule exists to prevent, and it is worth one explicit comparison.
  assert.notEqual(sitesComposite({ fifa_score: 9, espn_score: 6 }),
    sitesComposite({ fifa_score: 9, espn_score: 6, athletic_score: 0 }));
  assert.equal(sitesComposite({ fifa_score: 9, espn_score: 6 }), 7.5);
  assert.equal(sitesComposite({ fifa_score: 9, espn_score: 6, athletic_score: 0 }), 5);
});
