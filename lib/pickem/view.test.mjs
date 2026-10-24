// lib/pickem/view.test.mjs - homeWinPct: the moneyline's home win chance, de-vigged.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeWinPct } from './view.js';

test('homeWinPct de-vigs the two implied probabilities and rounds to a whole percent', () => {
  assert.equal(homeWinPct({ home: { implied: 0.66 }, away: { implied: 0.38 } }), 63);
  assert.equal(homeWinPct({ home: { implied: 0.5 }, away: { implied: 0.5 } }), 50);
  assert.equal(homeWinPct({ home: { implied: 0.2 }, away: { implied: 0.85 } }), 19);
});

test('homeWinPct is null without a clean two-sided read', () => {
  assert.equal(homeWinPct(undefined), null);
  assert.equal(homeWinPct({ home: { implied: 0.6 } }), null);
  assert.equal(homeWinPct({ home: { implied: 0 }, away: { implied: 0.5 } }), null);
  assert.equal(homeWinPct({ home: { implied: null }, away: { implied: 0.5 } }), null);
});
