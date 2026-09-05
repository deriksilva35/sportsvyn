// lib/games/lobby.test.mjs - the games lobby's per-game constants.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { HERO_LOCK_LABEL, GAME_ORDER } = await import('./lobby.js');

test("HERO_LOCK_LABEL: pickem reads 'next lock', weekly and draft read 'locks' (relay 2c item 3)", () => {
  // Pick'em's hero.locksAt is the nearest UNMET per-game lock among this
  // viewer's own open picks, not one shared deadline - "locks" would claim
  // a single instant that does not exist for this game the way it genuinely
  // does for Weekly/Draft (relay D1's "both rows or neither" contest).
  assert.equal(HERO_LOCK_LABEL.pickem, 'next lock');
  assert.equal(HERO_LOCK_LABEL.weekly, 'locks');
  assert.equal(HERO_LOCK_LABEL.draft, 'locks');
  // Every game the hero can ever represent has an entry - a missing key
  // would render "undefined <date>" rather than refusing loudly.
  for (const key of GAME_ORDER) assert.ok(HERO_LOCK_LABEL[key], `no HERO_LOCK_LABEL for '${key}'`);
});

test('the hero eyebrow reads the label from the one constant, never a hardcoded word', () => {
  const src = readFileSync(new URL('../../app/games/page.js', import.meta.url), 'utf8');
  assert.match(src, /HERO_LOCK_LABEL\[hero\.key\]/);
  assert.doesNotMatch(src, />locks <StandaloneDate/, 'a literal "locks" would ignore HERO_LOCK_LABEL for pickem');
});
