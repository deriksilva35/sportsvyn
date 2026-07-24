// Dash-scan + shape for the homepage sim promo copy. Pure, no env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIM_PROMO } from './simPromoCopy.js';

test('sim promo copy: shape', () => {
  assert.equal(SIM_PROMO.kicker, 'Fantasy');
  assert.match(SIM_PROMO.headline, /Draft against the market, not a spreadsheet\./);
  assert.match(SIM_PROMO.line, /graded on live ADP/);
  assert.match(SIM_PROMO.line, /Three free drafts a week/);
  assert.equal(SIM_PROMO.cta, 'Start a draft');
});

test('sim promo copy: hyphens only (no em/en dashes)', () => {
  for (const s of Object.values(SIM_PROMO)) {
    assert.ok(!/[—–]/.test(s), `em/en dash in: ${s}`);
  }
});
