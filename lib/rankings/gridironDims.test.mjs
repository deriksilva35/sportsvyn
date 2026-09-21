// lib/rankings/gridironDims.test.mjs - the Elo-to-dimension scale.
//
// THE FIELD IS FIXED AND THE ARITHMETIC IS DONE BY HAND. The five-value field
// below was chosen so its mean and standard deviation are exact integers,
// which makes every expected dimension a number a reader can check without
// running anything:
//
//   field  1400 1450 1500 1550 1600      mean 1500
//   deviations  -100 -50 0 +50 +100      squares 10000 2500 0 2500 10000
//   population variance  25000/5 = 5000  sd = sqrt(5000) = 70.710678...
//
// and with SPREAD = 2 the dimension is 5 + 2z:
//
//   1500 -> z 0        -> 5.0
//   1600 -> z  1.41421 -> 5 + 2.82843 = 7.82843 -> 7.8
//   1400 -> z -1.41421 -> 5 - 2.82843 = 2.17157 -> 2.2
//
// The two ends are ~1.41σ out, so NOTHING IN THIS FIELD CLAMPS - which is the
// point: a five-team field with a normal spread should use the middle of the
// scale, not pin at 0 and 10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zScale, fieldStats, gridironDims, SPREAD, SCORED_DIMS, HELD_DIMS } from './gridironDims.js';

const FIELD = [1400, 1450, 1500, 1550, 1600];

test('the fixed field: mean, sd, and every dimension it produces', () => {
  const { n, mean, sd } = fieldStats(FIELD);
  assert.equal(n, 5);
  assert.equal(mean, 1500);
  assert.ok(Math.abs(sd - Math.sqrt(5000)) < 1e-12, 'population sd, not sample');
  assert.equal(SPREAD, 2, 'the scale this file documents');
  assert.deepEqual(FIELD.map((v) => zScale(v, FIELD)), [2.2, 3.6, 5, 6.4, 7.8]);
  // The scale is symmetric about the mean, which is what "recentred on 5" means.
  assert.equal(zScale(1600, FIELD) - 5, 5 - zScale(1400, FIELD));
});

test('A ONE-TEAM FIELD IS z = 0 -> 5.0, and so is any field with no spread', () => {
  // THE MOST LIKELY SHAPE ON A FIRST RUN, and the one that produces NaN if the
  // divide-by-sd is not guarded.
  assert.equal(zScale(1500, [1500]), 5);
  assert.equal(zScale(1773.4, [1773.4]), 5, 'the single value need not be the start rating');
  // Every value identical: nobody is above or below anybody.
  assert.deepEqual([1500, 1500, 1500].map((v) => zScale(v, [1500, 1500, 1500])), [5, 5, 5]);
  // And it is 5.0 exactly, not NaN, not Infinity, not null.
  const one = zScale(1500, [1500]);
  assert.ok(Number.isFinite(one) && one === 5);
});

test('THE CLAMP HOLDS AT BOTH ENDS, and 2.5 sigma is where it bites', () => {
  // A field of exactly 0 and 10 has mean 5, sd 5; a value 2.5 sd out is the
  // first that would exceed the scale.
  const f = [0, 10];                       // mean 5, sd 5
  assert.equal(zScale(5, f), 5);
  assert.equal(zScale(10, f), 7, '1 sd up');
  assert.equal(zScale(17.5, f), 10, 'exactly 2.5 sd up lands ON the ceiling');
  assert.equal(zScale(1000, f), 10, 'and far beyond it does not keep climbing');
  assert.equal(zScale(-7.5, f), 0, 'exactly 2.5 sd down lands ON the floor');
  assert.equal(zScale(-1000, f), 0);
  // A value OUTSIDE the field is still scored against the field - the field is
  // the yardstick, not a whitelist.
  assert.equal(zScale(15, f), 9);
});

test('AN ABSENT VALUE IS HELD, NOT SCORED 5.0', () => {
  // The difference that matters: "no momentum signal" must not read as
  // "average momentum", or a team that has not played gets a free midpoint.
  assert.equal(zScale(null, FIELD), null);
  assert.equal(zScale(undefined, FIELD), null);
  assert.equal(zScale(NaN, FIELD), null);
  assert.equal(zScale('none', FIELD), null);
  // An empty field cannot rank anybody, whatever the value.
  assert.equal(zScale(1500, []), null);
  assert.equal(zScale(1500, null), null);
  // Non-finite members of the field are dropped rather than poisoning the mean.
  assert.equal(fieldStats([1500, null, 1500, 'x']).n, 2);
  assert.equal(fieldStats([1500, null, 1500]).mean, 1500);
  assert.deepEqual(fieldStats([]), { n: 0, mean: null, sd: null });
});

test('gridironDims scores TWO of five and HOLDS three, in the composer\'s shape', () => {
  const eloField = FIELD;
  const delta3Field = [-40, -20, 0, 20, 40];
  const d = gridironDims({ elo: 1600, delta3: 40, eloField, delta3Field });
  assert.equal(d.dims.result, 7.8);
  assert.equal(d.dims.momentum, 7.8, 'same shape of field, same place in it, same number');
  assert.deepEqual(d.dims, { result: 7.8, process: null, squad: null, coherence: null, momentum: 7.8 });
  assert.deepEqual(d.scored_dims, ['result', 'momentum']);
  assert.deepEqual(d.held_dims, ['process', 'squad', 'coherence']);
  assert.deepEqual([...SCORED_DIMS], ['result', 'momentum']);
  assert.deepEqual([...HELD_DIMS], ['process', 'squad', 'coherence']);
});

test('NO MOMENTUM SIGNAL: the dimension is held and scored_dims says so', () => {
  // A team with no rated games yet has an elo (the start rating) but no delta3.
  const d = gridironDims({ elo: 1500, delta3: null, eloField: FIELD, delta3Field: [-40, 40] });
  assert.equal(d.dims.result, 5);
  assert.equal(d.dims.momentum, null);
  assert.deepEqual(d.scored_dims, ['result'], 'ONE of five, and the composite will average over one');
  assert.deepEqual(d.held_dims, ['process', 'squad', 'coherence', 'momentum']);
  // No elo either - nothing is scored, and the caller can see that rather than
  // receiving a row of midpoints.
  const none = gridironDims({});
  assert.deepEqual(none.scored_dims, []);
  assert.deepEqual(none.dims, { result: null, process: null, squad: null, coherence: null, momentum: null });
});
