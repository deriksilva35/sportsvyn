// lib/pickem/preOpenHeadline.test.mjs - the pre-open board's headline (sun-16 A).
// It read "Pick'em lights up with the board" on /pickem/nba before the NBA
// season: no sport, and nothing about what was missing. PURE + one source pin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { preOpenHeadline } from './view.js';

test('the headline names the sport and what is not open', () => {
  assert.equal(preOpenHeadline('nba', { planned: true }), 'The next NBA Pick’em board is not open yet');
  assert.equal(preOpenHeadline('cfb', { planned: false }), 'No CFB Pick’em board is scheduled yet');
  assert.doesNotMatch(preOpenHeadline('nfl', { planned: true }), /lights up/);
});

test('/pickem/[sport] draws the headline from preOpenHeadline, both branches', () => {
  const src = readFileSync(new URL('../../app/pickem/[sport]/page.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /lights up with the board/);
  assert.match(src, /preOpenHeadline\(sport, \{ planned: false \}\)/);
  assert.match(src, /preOpenHeadline\(sport, \{ planned: true \}\)/);
});
