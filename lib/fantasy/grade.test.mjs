// lib/fantasy/grade.test.mjs — grade formula: band fixtures, K/DST exclusion, and
// the calibration distribution over 300 seeded auto-drafts.
// Run: node --test lib/fantasy/grade.test.mjs
//
// NO DATABASE. This suite used to load .env.local and read the live pool for its
// calibration corpus; that corpus is now the checked-in calibrationPool.fixture.json
// (see the calibration test below for why). Pure + deterministic — if this file ever
// needs a connection again, something has leaked out of the fixture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { gradeDraft, bandFor, BANDS } = await import('./grade.js');
const eng = await import('./engine.js');
const { poolConfigs, measureCalibration, breachStreak, shouldAlertCalibration, A_CEILING_PCT } =
  await import('./calibration.js');

const CONFIG = { teams_count: 12, roster_slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 } };
// Build a 15-pick user roster fixture. valueEach = displayValue (overall - adp) per
// SKILL pick; kdstValue = displayValue jammed onto K/DST (should be ignored).
function fixture({ valueEach = 0, kdstValue = 0, lateStarterRounds = [], benchAllRB = false, sameBye = false } = {}) {
  const recs = [];
  let ov = 1;
  const add = (rosterSlot, slotPos, round, dv, bye) => {
    recs.push({ rosterSlot, slotPos, round, overallPick: ov, adpAtPick: ov - dv, bye, synthetic: false, needWeight: 1.5, isUser: true, playerName: `${slotPos}${ov}` });
    ov += 1;
  };
  // 7 skill starters (rounds 1-7 unless overridden), value = valueEach
  const starters = [['RB', 'RB'], ['RB', 'RB'], ['WR', 'WR'], ['WR', 'WR'], ['TE', 'TE'], ['FLEX', 'RB'], ['QB', 'QB']];
  starters.forEach(([slot, pos], i) => add(slot, pos, lateStarterRounds[i] ?? (i + 1), valueEach, sameBye ? 7 : 10 + i));
  // 4 bench skill (rounds 8-11), value = valueEach
  for (let i = 0; i < 4; i++) add('BN', benchAllRB ? 'RB' : (i % 2 ? 'WR' : 'RB'), 8 + i, valueEach, 20 + i);
  // 2 more bench (rounds 12), K + DST late
  add('BN', 'RB', 12, valueEach, 30);
  add('BN', 'WR', 12, valueEach, 31);
  add('K', 'K', 14, kdstValue, null);
  add('DST', 'DST', 13, kdstValue, null);
  return recs;
}

// These pin the CURRENT edges. They were rewritten for the 2026-08-02
// recalibration (A 88->93, B 70->73, ...) because that is what a band-edge
// fixture is for; the calibration assertions further down - the 5% ceiling and
// the median band - are the invariants and were NOT touched.
test('band edges', () => {
  assert.equal(bandFor(93), 'A');
  assert.equal(bandFor(92.9), 'A-');
  assert.equal(bandFor(86), 'A-');
  assert.equal(bandFor(73), 'B');
  assert.equal(bandFor(72.9), 'B-');
  assert.equal(bandFor(66), 'B-');
  assert.equal(bandFor(62), 'C+');
  assert.equal(bandFor(38.9), 'F');
  assert.equal(BANDS[0][0], 'A');
});

test('at-market clean draft grades B- (value 50, construction 100)', () => {
  // 0.6*50 + 0.4*100 = 70. This used to be a B and is now a B-, which is the
  // recalibration doing exactly what it claims: a draft taken AT market with
  // clean construction is, by definition, the average draft - and the stated
  // principle is that the average draft lands B-/C+. Today's median auto-draft
  // scores 70.4, i.e. this same spot. It grading B was the generosity that the
  // three-day alert was reporting.
  const g = gradeDraft(fixture({ valueEach: 0 }), CONFIG);
  assert.equal(g.components.valueScore, 50);
  assert.equal(g.components.constructionScore, 100);
  assert.equal(g.grade, 'B-');
});

test('strong-value draft grades higher than at-market', () => {
  const base = gradeDraft(fixture({ valueEach: 0 }), CONFIG).gradeScore;
  const strong = gradeDraft(fixture({ valueEach: 12 }), CONFIG).gradeScore;
  assert.ok(strong > base, `strong ${strong} > base ${base}`);
});

test('K/DST value is EXCLUDED from the grade', () => {
  const plain = gradeDraft(fixture({ valueEach: 0, kdstValue: 0 }), CONFIG);
  const kdstJammed = gradeDraft(fixture({ valueEach: 0, kdstValue: 999 }), CONFIG);
  assert.equal(plain.components.valueScore, kdstJammed.components.valueScore, 'K/DST value must not move valueScore');
  assert.equal(plain.grade, kdstJammed.grade);
});

test('construction penalties: late starters, bench concentration, bye stack all deduct', () => {
  const clean = gradeDraft(fixture({}), CONFIG).components.constructionScore;
  const late = gradeDraft(fixture({ lateStarterRounds: [1, 2, 3, 4, 5, 12, 13] }), CONFIG).components.constructionScore;
  const bench = gradeDraft(fixture({ benchAllRB: true }), CONFIG).components.constructionScore;
  const bye = gradeDraft(fixture({ sameBye: true }), CONFIG).components.constructionScore;
  assert.ok(late < clean, 'late starters deduct');
  assert.ok(bench < clean, 'bench concentration deducts');
  assert.ok(bye < clean, 'bye stack deducts');
});

// The calibration corpus runs against a CHECKED-IN pool, not the live one.
//
// It used to read `max(snapshot_date)`, which was harmless when the pool was a
// single hand-written snapshot and became wrong the moment /api/cron/adp-snapshot
// started rewriting it daily: the test then re-derived calibration against fresh
// ADP every morning, so the A-rate moved with FFC's board (measured 3.7% on the
// 2026-07-15 pool, 5.7% on 2026-07-30) and a green suite depended on the market.
//
// The bands are what this test is for. Pinning the pool makes it deterministic: a
// failure here means grade.js or engine.js changed behaviour, which is the only
// thing it was ever able to tell us. The LIVE A-rate is a monitoring concern and
// lives in the adp-snapshot cron's sync_runs summary, which alerts if the rate
// stays over the ceiling for A_BREACH_STREAK days. Recalibrating bands is then a
// deliberate session with a methodology-doc update — never a test tweak.
test('calibration: 300 auto-drafts land median B-/C+ with A <= 5% (fixture pool)', async () => {
  const fixture = JSON.parse(readFileSync(path.join(__dirname, 'calibrationPool.fixture.json'), 'utf8'));
  const configs = poolConfigs(fixture.presets, fixture.rows);
  assert.equal(configs.length, 4, 'fixture must carry all four preset pools');

  const c = measureCalibration(configs);
  console.log(`  calibration (${fixture.snapshotDate}): median=${c.medianBand} (${c.median}), A=${c.aPct}%`);
  assert.equal(c.drafts, 300);
  assert.ok(['B-', 'C+'].includes(c.medianBand), `median band ${c.medianBand} should be B-/C+`);
  assert.ok(c.aPct <= A_CEILING_PCT, `A rate ${c.aPct}% should be <= ${A_CEILING_PCT}%`);
});

test('calibration is deterministic on the fixture (same pool, same numbers)', () => {
  const fixture = JSON.parse(readFileSync(path.join(__dirname, 'calibrationPool.fixture.json'), 'utf8'));
  const configs = poolConfigs(fixture.presets, fixture.rows);
  assert.deepEqual(measureCalibration(configs), measureCalibration(configs));
});

test('breachStreak / shouldAlertCalibration: only a sustained run alarms', () => {
  // newest-first readings of the live A-rate.
  assert.equal(breachStreak([5.7, 5.2, 6.1]), 3);
  assert.equal(breachStreak([5.7, 5.2]), 2);
  assert.equal(breachStreak([4.9, 5.2, 6.1]), 0);   // today is fine -> streak is 0
  assert.equal(breachStreak([5.7, 4.0, 6.1]), 1);   // yesterday broke the run
  assert.equal(breachStreak([5.0, 5.0, 5.0]), 0);   // exactly at the ceiling is OK
  assert.equal(breachStreak([]), 0);
  assert.equal(breachStreak([5.7, null, 6.1]), 1);  // an unmeasured day is not a breach
  assert.equal(breachStreak(undefined), 0);

  assert.equal(shouldAlertCalibration([5.7, 5.2, 6.1]), true);
  assert.equal(shouldAlertCalibration([5.7, 5.2]), false);        // two is not a trend
  assert.equal(shouldAlertCalibration([9, 9, 4.1, 9, 9]), false); // broken run
});
