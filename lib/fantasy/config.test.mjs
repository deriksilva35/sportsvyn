// lib/fantasy/config.test.mjs — draft-config validation, rounds derivation, and
// nearest-pool mapping. Expected values hand-computed from the stated bounds, not
// read off the implementation.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateConfig, deriveRounds, starterCount, rosterTokens, configLocks,
  nearestPoolPair, SCORING_FORMATS,
} from './config.js';

const std = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1, BN: 6 };
const base = { teamsCount: 12, scoringFormat: 'ppr', clockSeconds: 60, rosterSlots: { ...std } };

// ---- rounds derivation ----
test('deriveRounds sums every slot (starters + bench)', () => {
  assert.equal(deriveRounds(std), 15); // 1+2+2+1+1+1+1+6
  assert.equal(deriveRounds({ QB: 2, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1, BN: 5 }), 15);
  assert.equal(deriveRounds({}), 0);
});

test('starterCount excludes bench', () => {
  assert.equal(starterCount(std), 9); // 15 total minus 6 bench
});

// ---- validateConfig: happy path ----
test('accepts a valid config and normalizes it', () => {
  const r = validateConfig(base);
  assert.equal(r.ok, true);
  assert.equal(r.config.teamsCount, 12);
  assert.equal(r.config.scoringFormat, 'ppr');
  assert.equal(r.config.clockSeconds, 60);
  assert.equal(deriveRounds(r.config.rosterSlots), 15);
});

test('accepts null clock (no timer) and 16 teams and superflex', () => {
  assert.equal(validateConfig({ ...base, clockSeconds: null }).ok, true);
  assert.equal(validateConfig({ ...base, teamsCount: 16 }).ok, true);
  const sf = validateConfig({ ...base, rosterSlots: { ...std, SUPERFLEX: 1, BN: 5 } });
  assert.equal(sf.ok, true);
  assert.equal(sf.config.rosterSlots.SUPERFLEX, 1);
});

test('drops zero-count slots from the normalized config', () => {
  const r = validateConfig({ ...base, rosterSlots: { ...std, SUPERFLEX: 0 } });
  assert.equal(r.ok, true);
  assert.equal('SUPERFLEX' in r.config.rosterSlots, false);
});

// ---- validateConfig: rejections ----
test('rejects out-of-range teams, bad scoring, bad clock', () => {
  assert.equal(validateConfig({ ...base, teamsCount: 7 }).detail, 'teamsCount');
  assert.equal(validateConfig({ ...base, teamsCount: 17 }).detail, 'teamsCount');
  assert.equal(validateConfig({ ...base, teamsCount: 12.5 }).detail, 'teamsCount');
  assert.equal(validateConfig({ ...base, scoringFormat: 'superflex' }).detail, 'scoringFormat');
  assert.equal(validateConfig({ ...base, clockSeconds: 45 }).detail, 'clockSeconds');
});

test('rejects unknown slot keys and out-of-bounds counts', () => {
  assert.equal(validateConfig({ ...base, rosterSlots: { ...std, WRZ: 1 } }).detail, 'slot:WRZ');
  assert.equal(validateConfig({ ...base, rosterSlots: { ...std, QB: 5 } }).detail, 'slot:QB');
  assert.equal(validateConfig({ ...base, rosterSlots: { ...std, RB: -1 } }).detail, 'slot:RB');
});

test('rejects an empty starting lineup and an over-long roster', () => {
  assert.equal(validateConfig({ ...base, rosterSlots: { BN: 6 } }).detail, 'starters');
  assert.equal(validateConfig({ ...base, rosterSlots: { QB: 1, BN: 14, RB: 8, WR: 8 } }).detail, 'rounds');
});

test('rejects the sportsvyn board (not live yet) but allows market_adp', () => {
  assert.equal(validateConfig({ ...base, board: 'sportsvyn' }).detail, 'board');
  assert.equal(validateConfig({ ...base, board: 'market_adp' }).ok, true);
});

test('rejects non-object input', () => {
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig(undefined).reason, 'invalid_config');
});

// ---- configLocks (UI messaging) ----
test('configLocks flags oversize and superflex', () => {
  assert.deepEqual(configLocks(base), { oversize: false, superflex: false });
  assert.deepEqual(configLocks({ ...base, teamsCount: 14 }), { oversize: true, superflex: false });
  assert.deepEqual(configLocks({ ...base, rosterSlots: { ...std, SUPERFLEX: 1 } }), { oversize: false, superflex: true });
});

// ---- rosterTokens (ticker) ----
test('rosterTokens numbers only counts > 1, bench shows count, superflex after starters', () => {
  assert.deepEqual(rosterTokens(std), ['QB', 'RB2', 'WR2', 'TE', 'FLEX', 'DST', 'K', 'BN6']);
  assert.deepEqual(
    rosterTokens({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1, DST: 1, K: 1, BN: 5 }),
    ['QB', 'RB2', 'WR2', 'TE', 'FLEX', 'DST', 'K', 'SUPERFLEX', 'BN5'],
  );
});

// ---- nearestPoolPair ----
const PAIRS = [
  { scoringFormat: 'ppr', teamsCount: 12 },
  { scoringFormat: 'half-ppr', teamsCount: 10 },
  { scoringFormat: 'standard', teamsCount: 8 },
  { scoringFormat: '2qb', teamsCount: 12 },
];

test('exact pool pair maps to itself', () => {
  const r = nearestPoolPair({ scoringFormat: 'ppr', teamsCount: 12 }, PAIRS);
  assert.deepEqual(r.pair, { scoringFormat: 'ppr', teamsCount: 12 });
  assert.equal(r.exact, true);
  assert.equal(r.scoringExact, true);
});

test('same scoring, different size maps to the nearest size (scoring exact, inexact size)', () => {
  const r = nearestPoolPair({ scoringFormat: 'ppr', teamsCount: 14 }, PAIRS);
  assert.deepEqual(r.pair, { scoringFormat: 'ppr', teamsCount: 12 }); // only ppr pool is 12
  assert.equal(r.scoringExact, true);
  assert.equal(r.exact, false);
});

test('scoring is matched before size', () => {
  // desired half-ppr @ 8: the standard pool is exact size (8) but wrong scoring;
  // half-ppr @ 10 must win because scoring is matched first.
  const r = nearestPoolPair({ scoringFormat: 'half-ppr', teamsCount: 8 }, PAIRS);
  assert.deepEqual(r.pair, { scoringFormat: 'half-ppr', teamsCount: 10 });
  assert.equal(r.scoringExact, true);
});

test('closest size ties break to the larger pool', () => {
  const pairs = [
    { scoringFormat: 'ppr', teamsCount: 10 },
    { scoringFormat: 'ppr', teamsCount: 14 },
  ];
  const r = nearestPoolPair({ scoringFormat: 'ppr', teamsCount: 12 }, pairs);
  assert.equal(r.pair.teamsCount, 14); // |12-10| == |12-14|, tie -> larger
});

test('falls back across scorings only when the scoring has no pool', () => {
  const pairs = [{ scoringFormat: 'ppr', teamsCount: 12 }];
  const r = nearestPoolPair({ scoringFormat: 'standard', teamsCount: 10 }, pairs);
  assert.deepEqual(r.pair, { scoringFormat: 'ppr', teamsCount: 12 });
  assert.equal(r.scoringExact, false);
  assert.equal(r.exact, false);
});

test('returns null when no pools exist at all', () => {
  assert.equal(nearestPoolPair({ scoringFormat: 'ppr', teamsCount: 12 }, []), null);
});

test('every scoring format has a label', () => {
  for (const f of SCORING_FORMATS) assert.ok(f);
});
