// lib/gridiron/gameTabsNav.test.mjs — one builder, one parser, round-tripped.
// Run: node --test lib/gridiron/gameTabsNav.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGameTab, gameTabHref } from './gameTabsNav.js';

const K = ['drives', 'players'];

test('the default tab is OMITTED from the URL - one page, one URL', () => {
  assert.equal(gameTabHref('/cfb/game/x', 'drives', K), '/cfb/game/x');
  assert.equal(gameTabHref('/cfb/game/x', null, K), '/cfb/game/x');
  assert.equal(gameTabHref('/cfb/game/x', 'players', K), '/cfb/game/x?tab=players');
});

test('ROUND TRIP: every key the page declares survives build -> parse', () => {
  for (const k of K) {
    const href = gameTabHref('/cfb/game/x', k, K);
    const sp = Object.fromEntries(new URL(href, 'https://sportsvyn.com').searchParams);
    assert.equal(parseGameTab(sp, K), k, `${k} did not survive the round trip`);
  }
});

test('junk, absence, and a panel this game does not have all fall to the default', () => {
  assert.equal(parseGameTab({ tab: 'nope' }, K), 'drives');
  assert.equal(parseGameTab({}, K), 'drives');
  assert.equal(parseGameTab({ tab: '' }, K), 'drives');
  // A CFB link pasted at an NFL game: the key is real but not on this page.
  assert.equal(parseGameTab({ tab: 'drives' }, ['brief', 'players']), 'brief');
  // Next's repeated-param array form.
  assert.equal(parseGameTab({ tab: ['players'] }, K), 'players');
});

test('the KEYS COME FROM THE PAGE, not from a list in this module', () => {
  // A hard-coded key list here would have to be edited every time a panel is
  // added, and would silently select nothing for a page it had not heard of.
  const code = readFileSync(new URL('./gameTabsNav.js', import.meta.url), 'utf8');
  assert.equal(/const (KEYS|TABS)\s*=/.test(code), false);
  assert.match(code, /export function parseGameTab\(sp = \{\}, keys = \[\]\)/);
  // No panels, no crash and no invented key.
  assert.equal(parseGameTab({ tab: 'players' }, []), null);
  assert.equal(gameTabHref('/x', 'players', []), '/x');
});

test('NO SECOND BUILDER - the rail builds its href here and nowhere else', () => {
  const tabs = readFileSync(new URL('../../components/gridiron/GameTabs.js', import.meta.url), 'utf8');
  assert.match(tabs, /import \{ gameTabHref \} from '@\/lib\/gridiron\/gameTabsNav'/);
  assert.match(tabs, /gameTabHref\(basePath, p\.key, panels\.map/);
  // The forbidden shape: a template literal assembling ?tab= by hand.
  assert.equal(/[`'"]\?tab=/.test(tabs.replace(/\/\*[\s\S]*?\*\//g, '')), false);
  // and it REPLACES rather than navigates - the panels are already in the DOM.
  assert.match(tabs, /window\.history\.replaceState/);
  assert.equal(/router\.push|<Link/.test(tabs), false);
});

test('a value is encoded, never interpolated raw', () => {
  assert.match(gameTabHref('/x', 'a b', ['drives', 'a b']), /\?tab=a%20b$/);
});
