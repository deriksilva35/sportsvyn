// lib/winprob/predict.test.mjs - the JS port against the Python artefacts'
// own 200-play fixtures, per sport, to 1e-9; the per-sport spread sign; and
// the rule that a game with no line gets no number.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { predict, predictNfl, predictCfb, priorLogit, spreadForModel, bucketOf, cfbTimeBucket, cfbSpline, MODELS, MODEL_VERSION } from './predict.js';

const fixture = (s) => JSON.parse(readFileSync(new URL(`./fixtures/${s}-plays.json`, import.meta.url), 'utf8'));

for (const sport of ['nfl', 'cfb']) {
  test(`PARITY ${sport}: all 200 fixture plays to 1e-9`, () => {
    const j = fixture(sport);
    assert.equal(j.cases.length, 200); assert.equal(j.tolerance, 1e-9);
    let max = 0;
    for (const c of j.cases) {
      const p = predict(sport, c.inputs, c.inputs.prior_logit);
      max = Math.max(max, Math.abs(p - c.expected_p_home));
    }
    assert.ok(max <= 1e-9, `max |diff| ${max}`);
  });
}

test('THE SPREAD SIGN IS PER SPORT: our home value -3 (home favoured) is +3 for NFL and -3 for CFB', () => {
  assert.equal(spreadForModel('nfl', -3), 3);
  assert.equal(spreadForModel('cfb', -3), -3);
  assert.throws(() => spreadForModel('mlb', -3), /no spread convention/, 'a third sport inherits nothing');
  // and both land on a home-favoured prior
  assert.ok(priorLogit('nfl', spreadForModel('nfl', -3)) > 0);
  assert.ok(priorLogit('cfb', spreadForModel('cfb', -3)) > 0);
  assert.ok(priorLogit('nfl', spreadForModel('nfl', 7)) < 0, 'home +7 is an underdog');
  assert.ok(priorLogit('cfb', spreadForModel('cfb', 7)) < 0);
  // the artefacts say the same thing in words
  assert.match(MODELS.nfl.spread_convention.sign, /POSITIVE spread_line MEANS THE HOME TEAM IS FAVOURED/);
  assert.match(MODELS.cfb.spread_convention.sign, /NEGATIVE spread MEANS THE HOME TEAM IS FAVOURED/);
});

test('NO LINE, NO NUMBER: a null prior is null - there is no fallback', () => {
  const s = fixture('nfl').cases[0].inputs;
  assert.equal(priorLogit('nfl', null), null);
  assert.equal(spreadForModel('nfl', null), null);
  assert.equal(predictNfl(s, null), null);
  assert.equal(predictCfb({ ...s, season: 2026 }, null), null);
  assert.equal(predict('nfl', s, priorLogit('nfl', spreadForModel('nfl', null))), null);
});

test('buckets are numpy digitize on the interior edges - what the fixtures encode, not the prose', () => {
  const e = [0, 1, 3, 6, 10, 15, 100];
  assert.equal(bucketOf(1, e, 6), 1, '1 yard to go is the second bucket: the <= reading');
  assert.equal(bucketOf(0.5, e, 6), 0);
  assert.equal(bucketOf(10, e, 6), 4);
  assert.equal(bucketOf(99, e, 6), 5); assert.equal(bucketOf(500, e, 6), 5);
  assert.deepEqual([0, 299, 300, 900, 1800, 3600].map(cfbTimeBucket), [0, 0, 1, 2, 3, 3]);
  assert.deepEqual(cfbSpline(0), [0, 0, 0], 'the spline vanishes at a level score');
  assert.deepEqual(cfbSpline(60), [4, 0, 3], 'sd is clipped to 40 first');
});

test('model versions are the artefacts\' own', () => {
  assert.equal(MODEL_VERSION.nfl, 'sportsvyn-winprob-nfl@1.0.0');
  assert.equal(MODEL_VERSION.cfb, 'sportsvyn-winprob-cfb@0.1.0-shadow');
});
