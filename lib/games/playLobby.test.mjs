// lib/games/playLobby.test.mjs - the Play lobby's rules, on fixtures (thu-38 + fri-1).
//
// EVERY BOUNDARY IS A FIXTURE RELATIVE TO `NOW`, which is passed, never read:
// a fixture that typed a date would be the dated cheque CLAUDE.md warns about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  phaseOf, isActionable, locksSoon, yourMove, sportChips, groupsFor, playLobby, normalizeSport,
  LOCKS_SOON_MS, SIGNED_OUT_MOVES,
} from './playLobby.js';

const NOW = new Date('2026-10-01T18:00:00Z');
const H = 3_600_000; const D = 24 * H;
const at = (ms) => new Date(NOW.getTime() + ms).toISOString();

const item = (key, sport, o = {}) => ({ key, sport, name: key, mark: key[0].toUpperCase(), href: `/${key}`, cta: 'GO',
  title: key, status: '', opensAt: null, locksAt: at(10 * H), settled: false, complete: false, ...o });

test('phase: done, upcoming, open, locked - from the item\'s own times', () => {
  assert.equal(phaseOf(item('a', 'nfl', { settled: true }), NOW), 'done');
  assert.equal(phaseOf(item('a', 'nfl', { opensAt: at(H) }), NOW), 'upcoming');
  assert.equal(phaseOf(item('a', 'nfl', { opensAt: at(-H), locksAt: at(H) }), NOW), 'open');
  assert.equal(phaseOf(item('a', 'nfl', { locksAt: at(-1) }), NOW), 'locked');
  assert.equal(phaseOf(item('a', 'nfl', { locksAt: null }), NOW), 'locked', 'nothing left to beat is not open');
  assert.equal(phaseOf(item('a', 'nfl', { locksAt: NOW.toISOString() }), NOW), 'locked', 'a lock AT now has passed');
});

test('actionable = open and not complete', () => {
  assert.equal(isActionable(item('a', 'nfl'), NOW), true);
  assert.equal(isActionable(item('a', 'nfl', { complete: true }), NOW), false, 'a finished card is not your move');
  assert.equal(isActionable(item('a', 'nfl', { opensAt: at(H) }), NOW), false, 'not open yet');
  assert.equal(isActionable(item('a', 'nfl', { locksAt: at(-H) }), NOW), false, 'locked');
});

test('LOCKS SOON is a lock UNDER three hours away: 2:59:59 yes, 3:00:00 no', () => {
  assert.equal(locksSoon(item('a', 'nfl', { locksAt: at(LOCKS_SOON_MS - 1000) }), NOW), true);
  assert.equal(locksSoon(item('a', 'nfl', { locksAt: at(LOCKS_SOON_MS) }), NOW), false, 'exactly 3h is not under 3h');
  assert.equal(locksSoon(item('a', 'nfl', { locksAt: at(LOCKS_SOON_MS + 1000) }), NOW), false);
  assert.equal(locksSoon(item('a', 'nfl', { locksAt: at(60_000) }), NOW), true, 'a minute out');
  assert.equal(locksSoon(item('a', 'nfl', { locksAt: at(-60_000) }), NOW), false, 'a passed lock is not soon - it is locked');
  assert.equal(locksSoon(item('a', 'nfl', { opensAt: at(H), locksAt: at(2 * H) }), NOW), false, 'not open, not soon');
});

test('YOUR MOVE: signed in, every actionable item across sports, soonest lock first, tagged', () => {
  const items = [
    item('weekly', 'nfl', { locksAt: at(3 * D) }),
    item('october', 'mlb', { locksAt: at(2 * H) }),
    item('draft', 'nfl', { locksAt: at(5 * H) }),
    item('six', 'nba', { locksAt: at(26 * H), complete: true }),
    item('cfb', 'cfb', { opensAt: at(D), locksAt: at(3 * D) }),
    item('daily', 'all', { locksAt: at(8 * H) }),
  ];
  const m = yourMove(items, { now: NOW, signedIn: true });
  assert.deepEqual(m.map((i) => i.key), ['october', 'draft', 'daily', 'weekly'], 'complete and not-yet-open are left out');
  assert.deepEqual(m.map((i) => i.locksSoon), [true, false, false, false]);
});

test('YOUR MOVE signed out: the THREE soonest-locking open games, entries ignored', () => {
  const items = [
    item('a', 'nfl', { locksAt: at(9 * H) }),
    item('b', 'mlb', { locksAt: at(1 * H) }),
    item('c', 'nba', { locksAt: at(4 * H), complete: true }), // a signed-out item is never complete; open is what counts
    item('d', 'cfb', { locksAt: at(2 * H) }),
    item('e', 'nfl', { opensAt: at(H), locksAt: at(30 * H) }),
    item('f', 'all', { locksAt: at(20 * H) }),
  ];
  const m = yourMove(items, { now: NOW, signedIn: false });
  assert.equal(m.length, SIGNED_OUT_MOVES);
  assert.deepEqual(m.map((i) => i.key), ['b', 'd', 'c']);
});

test('THE CHIP FILTERS YOUR MOVE too, and the cards keep their order', () => {
  const items = [
    item('weekly', 'nfl', { locksAt: at(3 * D) }),
    item('october', 'mlb', { locksAt: at(2 * H) }),
    item('draft', 'nfl', { locksAt: at(5 * H) }),
    item('daily', 'all', { locksAt: at(8 * H) }),
  ];
  assert.deepEqual(yourMove(items, { now: NOW, signedIn: true, chip: 'nfl' }).map((i) => i.key), ['draft', 'weekly']);
  assert.deepEqual(yourMove(items, { now: NOW, signedIn: true, chip: 'mlb' }).map((i) => i.key), ['october']);
  assert.deepEqual(yourMove(items, { now: NOW, signedIn: false, chip: 'nfl' }).map((i) => i.key), ['draft', 'weekly'],
    'signed out, the three are the CHIP\'s three');
  assert.deepEqual(yourMove(items, { now: NOW, signedIn: true, chip: 'nba' }), [], 'a sport with nothing to do has no moves');
  const v = playLobby(items, { now: NOW, signedIn: true, chip: 'nfl' });
  assert.deepEqual(v.yourMove.map((i) => i.key), ['draft', 'weekly'], 'the whole-screen shape applies the same filter');
  assert.equal(v.daily, null, 'The Daily is ALL SPORTS only');
});

test('CHIPS: ALL + each sport with a game in the next 14 days, in the house order', () => {
  const games = {
    nfl: at(2 * D), cfb: at(1 * D),
    nba: at(14 * D), // exactly 14 days: in
    epl: at(14 * D + 1000), // a second past: out
    mlb: at(-2 * H), // a game live now (min kickoff in the past): in
  };
  assert.deepEqual(sportChips([], { now: NOW, nextGameBySport: games }), ['all', 'nfl', 'mlb', 'nba', 'cfb']);
  assert.deepEqual(sportChips([], { now: NOW, nextGameBySport: {} }), ['all'], 'no games, only ALL');
});

test('CHIPS: a registered game opening inside 14 days earns its sport a chip; one past it does not', () => {
  const inside = [item('six', 'nba', { opensAt: at(13 * D), locksAt: null })];
  const outside = [item('six', 'nba', { opensAt: at(15 * D), locksAt: null })];
  assert.deepEqual(sportChips(inside, { now: NOW }), ['all', 'nba']);
  assert.deepEqual(sportChips(outside, { now: NOW }), ['all']);
  assert.deepEqual(sportChips([item('oct', 'mlb')], { now: NOW }), ['all', 'mlb'], 'an open game is a game');
  assert.deepEqual(sportChips([item('d', 'all')], { now: NOW }), ['all'], 'The Daily is not a sport');
  assert.deepEqual(sportChips([], { now: NOW, chip: 'epl' }), ['all', 'epl'], 'the chip the reader is on is always drawn');
});

test('GROUPS: ordered by each sport\'s soonest OPEN lock, then by the soonest door', () => {
  const items = [
    item('weekly', 'nfl', { locksAt: at(3 * D) }),
    item('pickem', 'nfl', { locksAt: at(6 * H) }),
    item('october', 'mlb', { locksAt: at(2 * H) }),
    item('cfb', 'cfb', { locksAt: at(20 * H) }),
    item('six', 'nba', { opensAt: at(2 * D), locksAt: null }),
    item('daily', 'all', { locksAt: at(8 * H) }),
  ];
  const g = groupsFor(items, { now: NOW });
  assert.deepEqual(g.groups.map((x) => x.sport), ['mlb', 'nfl', 'cfb', 'nba'],
    'mlb locks first; nfl at 6h (its soonest row), cfb at 20h; nba has only a door, so it follows');
  assert.deepEqual(g.groups.find((x) => x.sport === 'nfl').rows.map((r) => r.key), ['weekly', 'pickem'],
    'rows keep the registry order inside a sport');
  assert.equal(g.daily.rows[0].key, 'daily');
  assert.deepEqual(g.collapsed, []);
});

test('COLLAPSE: nothing open in the next 7 days -> one line at the bottom', () => {
  const items = [
    item('pickem', 'nfl', { locksAt: at(6 * H) }),
    item('six', 'nba', { opensAt: at(7 * D + 1000), locksAt: null }), // a door a second past 7 days
    item('pk', 'nba', { opensAt: at(19 * D), locksAt: null }),
    item('wk5', 'epl', { opensAt: at(7 * D), locksAt: null }), // a door exactly 7 days out: stays a group
    item('run', 'mlb', { settled: true, locksAt: null }), // a finished round and nothing else
  ];
  const g = groupsFor(items, { now: NOW });
  assert.deepEqual(g.groups.map((x) => x.sport), ['nfl', 'epl']);
  assert.deepEqual(g.collapsed.map((x) => x.sport), ['nba', 'mlb'], 'the next door first; no door last');
  assert.equal(g.collapsed[0].opensAt, at(7 * D + 1000), 'the line names the NEXT door');
  assert.equal(g.collapsed[1].opensAt, null);
  assert.equal(g.collapsed[0].href, '/six');
});

test('COLLAPSE: a selected sport never collapses, and a dead season with no chip is not a line', () => {
  const items = [item('pk', 'nba', { opensAt: at(19 * D), locksAt: null }), item('run', 'mlb', { settled: true, locksAt: null })];
  const nba = groupsFor(items, { now: NOW, chip: 'nba' });
  assert.deepEqual(nba.groups.map((x) => x.sport), ['nba'], 'NBA chip: its group, dimmed rows and all');
  assert.equal(nba.groups[0].rows[0].phase, 'upcoming');
  assert.deepEqual(nba.collapsed, []);
  const all = groupsFor(items, { now: NOW, chips: ['all', 'nba'] });
  assert.deepEqual(all.collapsed.map((x) => x.sport), ['nba'], 'MLB has no chip and no door: left out, not collapsed');
});

test('normalizeSport: a known sport or ALL, nothing else', () => {
  assert.equal(normalizeSport('NBA'), 'nba');
  assert.equal(normalizeSport(['mlb']), 'mlb');
  assert.equal(normalizeSport('hockey'), 'all');
  assert.equal(normalizeSport(undefined), 'all');
});
