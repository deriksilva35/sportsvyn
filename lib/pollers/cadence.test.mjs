// Daily futures gating (pure; cadence.js has no db import).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFuturesTick, ODDS_FUTURES_HOUR } from './cadence.js';

test('isFuturesTick: only the top-of-hour tick of the futures hour', () => {
  assert.equal(isFuturesTick(new Date('2026-07-25T09:00:00Z')), true);
  assert.equal(isFuturesTick(new Date('2026-07-25T09:14:00Z')), true);  // min < 15
  assert.equal(isFuturesTick(new Date('2026-07-25T09:20:00Z')), false); // min >= 15
  assert.equal(isFuturesTick(new Date('2026-07-25T10:00:00Z')), false); // wrong hour
  assert.equal(ODDS_FUTURES_HOUR, 9);
});
