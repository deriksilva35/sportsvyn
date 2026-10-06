// The one-line note after a late claim. Source pin: the page renders it only
// from the stored run's own late_claim flag, in the closed-receipt branch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./page.js', import.meta.url), 'utf8');

test('late-claim note: exact copy, gated on the run late_claim flag', () => {
  assert.match(src, /existing\.late_claim === true/);
  assert.ok(src.includes('Saved to your streak. Today&rsquo;s board had already closed.'));
});

test('late-claim note sits in the stored-grade branch, before its SeasonBoard', () => {
  const note = src.indexOf('sbd-late-claim');
  const branch = src.indexOf('A3: land on the STORED grade');
  const nextBoard = src.indexOf('<SeasonBoard', branch);
  assert.ok(branch > 0 && note > branch && note < nextBoard);
});
