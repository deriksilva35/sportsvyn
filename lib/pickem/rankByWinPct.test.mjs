// lib/pickem/rankByWinPct.test.mjs - "Rank by win %", pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankByWinPct, sidePct } from './rankByWinPct.js';

const row = (id, confidence, home, o = {}) => ({
  id, locked: false, confidence, pick: null, winPct: home == null ? null : { home, away: 100 - home }, ...o,
});
const setOf = (m) => Object.values(m).sort((a, b) => a - b);

test('unpicked rows rank by the favourite: biggest win % gets the biggest number', () => {
  const out = rankByWinPct([row(1, 3, 55), row(2, 2, 20), row(3, 1, 70)]);   // favs 55, 80 (away), 70
  assert.deepEqual(out, { 2: 3, 3: 2, 1: 1 });
});

test('a pick uses the PICKED side: an underdog pick ranks low, a favourite pick high', () => {
  // game 1 home 80%, picked AWAY (20%); game 2 home 60% picked home (60%); game 3 home 30% picked away (70%)
  const out = rankByWinPct([row(1, 3, 80, { pick: 'away' }), row(2, 2, 60, { pick: 'home' }), row(3, 1, 30, { pick: 'away' })]);
  assert.deepEqual(out, { 3: 3, 2: 2, 1: 1 });
  // the same game unpicked would have ranked first
  assert.equal(rankByWinPct([row(1, 3, 80), row(2, 2, 60)])[1], 3);
});

test('locked rows keep their number; the unlocked numbers are redistributed among themselves', () => {
  const out = rankByWinPct([
    row(1, 4, 51), row(2, 3, 99, { locked: true }), row(3, 2, 90), row(4, 1, 60),
  ]);
  assert.equal(out[2], 3, 'locked untouched');
  assert.deepEqual({ 1: out[1], 3: out[3], 4: out[4] }, { 3: 4, 4: 2, 1: 1 });
  assert.deepEqual(setOf(out), [1, 2, 3, 4], 'the set of numbers is preserved');
});

test('rows with no line take the lowest numbers, in their current order', () => {
  const out = rankByWinPct([row(1, 4, null), row(2, 3, 60), row(3, 2, null), row(4, 1, 75)]);
  assert.deepEqual(out, { 4: 4, 2: 3, 1: 2, 3: 1 });
});

test('ties keep the current order', () => {
  const out = rankByWinPct([row(1, 3, 60), row(2, 2, 40), row(3, 1, 60)]);   // all favs 60
  assert.deepEqual(out, { 1: 3, 2: 2, 3: 1 });
});

test('input order does not matter, picks are never in the output, a lone row is unchanged', () => {
  const a = rankByWinPct([row(3, 1, 70), row(1, 3, 55), row(2, 2, 20)]);
  assert.deepEqual(a, { 2: 3, 3: 2, 1: 1 });
  assert.deepEqual(rankByWinPct([row(9, 5, 40)]), { 9: 5 });
  assert.deepEqual(rankByWinPct([]), {});
});

test('sidePct: a side, the favourite, and no line', () => {
  assert.equal(sidePct({ home: 30, away: 70 }, 'home'), 30);
  assert.equal(sidePct({ home: 30, away: 70 }, null), 70);
  assert.equal(sidePct(null, 'home'), null);
  assert.equal(sidePct({ home: NaN, away: NaN }, null), null);
});
