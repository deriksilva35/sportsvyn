// Dash-scan for the static league-page copy. Pure, no env.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUITE_TEASERS, UPSET_NOTE, MARKET_FINE, READ_BLANK } from './leagueCopy.js';

test('league copy: hyphens only (no em/en dashes)', () => {
  const strings = [UPSET_NOTE, MARKET_FINE, READ_BLANK.headline, READ_BLANK.nfl, READ_BLANK.cfb];
  for (const t of SUITE_TEASERS) strings.push(t.lock, t.headline, t.body);
  for (const s of strings) assert.ok(!/[—–]/.test(s), `em/en dash in: ${s}`);
});
test('suite teasers: two cards referencing the Football Suite', () => {
  assert.equal(SUITE_TEASERS.length, 2);
  assert.match(SUITE_TEASERS[0].body, /Football Suite/);
  assert.match(SUITE_TEASERS[1].body, /Football Suite/);
});
