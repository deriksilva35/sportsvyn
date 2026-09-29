// lib/today/gamesBandCards.test.mjs - the front page's game cards say what is true (tue-3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickemLockLine } from './gamesBandCards.js';
import { lockLabel } from '../pickem/read.js';

test('lockLabel never prints the epoch: no date, no label', () => {
  assert.equal(lockLabel(null), null);
  assert.equal(lockLabel(undefined), null);
  assert.equal(lockLabel('not a date'), null);
  assert.match(lockLabel('2026-10-02T00:15:00Z'), /^Thu Oct 1, 8:15 PM ET$/);
});

test('Pick\'em: "locks <next>" while a game is ahead; "all games kicked" once none is - never Wed Dec 31', () => {
  assert.equal(pickemLockLine({ nextKickoff: '2026-10-04T17:00:00Z' }), 'locks Sun Oct 4, 1:00 PM ET');
  assert.equal(pickemLockLine({ nextKickoff: null }), 'all games kicked', 'the lobby row\'s words for the same state');
  assert.equal(pickemLockLine({}), 'all games kicked');
  assert.doesNotMatch(pickemLockLine({ nextKickoff: null }), /Dec 31/);
});

test('GamesBand reads the Pick\'em lock line from here', () => {
  const src = readFileSync(new URL('../../components/today/GamesBand.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.match(code, /pickemLockLine\(pickem\)/);
});
