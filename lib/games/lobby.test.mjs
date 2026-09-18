// lib/games/lobby.test.mjs - the games lobby's per-game constants.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { HERO_LOCK_LABEL, GAME_ORDER, normalizePickemSeasonSport } = await import('./lobby.js');

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

test('GAMES v3: the hero stays retired, and no lock word is written into the screen', () => {
  const src = readFileSync(new URL('../../app/games/page.js', import.meta.url), 'utf8')
    + readFileSync(new URL('../../components/games/LobbyV3.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /HERO_LOCK_LABEL|<Hero /, 'no hero on the v3 lobby');
  // v3 GOES FURTHER THAN v2 DID: v2 kept one literal 'locks <StandaloneDate'
  // on the Weekly card. The v3 screen renders NOTHING it computed itself -
  // every word on a row comes from lib/games/v3Rows.js - so the count is 0,
  // and this assertion is what keeps a stray one out.
  assert.equal((src.match(/locks <StandaloneDate/g) ?? []).length, 0);
  // The v2 shapes are still live: lobbyV3 composes lobbyV2()'s reads.
  const shape = readFileSync(new URL('./lobbyV2Shape.js', import.meta.url), 'utf8');
  assert.match(shape, /first lock /); assert.match(shape, /rooms open /);
  assert.ok(HERO_LOCK_LABEL.pickem, 'the constant still serves the other surfaces');
});

test("normalizePickemSeasonSport: null is 'All', an unknown value falls back to null, not a sport (relay 2c item 7)", () => {
  assert.equal(normalizePickemSeasonSport(undefined), null);
  assert.equal(normalizePickemSeasonSport(null), null);
  assert.equal(normalizePickemSeasonSport('all'), null);
  assert.equal(normalizePickemSeasonSport('ALL'), null);
  assert.equal(normalizePickemSeasonSport('nfl'), 'nfl');
  assert.equal(normalizePickemSeasonSport('CFB'), 'cfb');
  // An unrecognised value is treated as 'All', the same safe direction
  // normalizePane() takes for an unknown pane - never a guessed sport.
  assert.equal(normalizePickemSeasonSport('xyz'), null);
});
