// lib/games/playLobby.test.mjs - the Play lobby's rules, on fixtures (thu-38 + fri-1).
//
// EVERY BOUNDARY IS A FIXTURE RELATIVE TO `NOW`, which is passed, never read:
// a fixture that typed a date would be the dated cheque CLAUDE.md warns about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  phaseOf, isActionable, locksSoon, yourMove, sportChips, groupsFor, playLobby, normalizeSport,
  LOCKS_SOON_MS, SIGNED_OUT_MOVES, isMoveCandidate, cardSummary, countWords, playLobbyOpen, normalizeOpen, ALL_SPORTS_CARD,
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

// ===========================================================================
// THE COLLAPSED CARDS (sun-19)
// ===========================================================================
const SLATE = () => [
  item('weekly', 'nfl', { name: 'The Weekly', status: '6 of 6', locksAt: at(3 * D), progress: { done: 6, total: 6 }, complete: true }),
  item('pickem', 'nfl', { name: "Pick'em", status: '3 of 16 picked', locksAt: at(5 * H), progress: { done: 3, total: 16 } }),
  item('october', 'mlb', { name: 'October', status: '0 of 5 picked', locksAt: at(2 * H), progress: { done: 0, total: 5 } }),
  item('run', 'mlb', { name: 'The Run', locksAt: null }),
  item('cfb', 'cfb', { name: "Pick'em", opensAt: at(D), locksAt: null }),
  item('six', 'nba', { name: "Tonight's Six", opensAt: at(19 * D), locksAt: null }),
  item('daily', 'all', { name: 'The Daily', game: 'daily', status: "Today's puzzle · 8 slots", at: { iso: at(8 * H), words: 'closes' }, locksAt: at(8 * H) }),
];

test('YOUR MOVE has ONE predicate: yourMove() is exactly the items isMoveCandidate admits (signed in; signed out the first three)', () => {
  const items = SLATE();
  for (const signedIn of [true, false]) {
    const admitted = items.filter((i) => isMoveCandidate(i, { now: NOW, signedIn })).map((i) => i.key).sort();
    const moves = yourMove(items, { now: NOW, signedIn }).map((i) => i.key);
    if (signedIn) assert.deepEqual([...moves].sort(), admitted);
    else { assert.equal(moves.length, Math.min(SIGNED_OUT_MOVES, admitted.length)); for (const k of moves) assert.ok(admitted.includes(k)); }
  }
  assert.equal(isMoveCandidate(item('a', 'nfl', { complete: true }), { now: NOW, signedIn: true }), false, 'done is not a move');
  assert.equal(isMoveCandidate(item('a', 'nfl', { complete: true }), { now: NOW, signedIn: false }), true, 'signed out: open is enough');
});

test('CARDS: active sports by soonest lock, then ALL SPORTS, then out of season dimmed with its door; the tag follows YOUR MOVE', () => {
  const v = playLobby(SLATE(), { now: NOW, signedIn: true, nextGameBySport: { nfl: at(D), mlb: at(H), cfb: at(D) } });
  assert.deepEqual(v.cards.map((c) => c.id), ['mlb', 'nfl', 'cfb', ALL_SPORTS_CARD, 'nba']);
  assert.deepEqual(v.cards.map((c) => c.count), [2, 2, 1, 1, 1]);
  assert.deepEqual(v.cards.map((c) => c.dim), [false, false, false, false, true]);
  assert.equal(v.cards[4].opensAt, at(19 * D));
  const moveKeys = new Set(v.yourMove.map((m) => m.key));
  for (const c of v.cards) assert.equal(c.move, c.rows.some((r) => moveKeys.has(r.key)), c.id);
  assert.deepEqual(v.cards.filter((c) => c.move).map((c) => c.id), ['mlb', 'nfl', ALL_SPORTS_CARD]);
  // the weekly is complete, so if pick'em were done too NFL would lose its tag
  const done = SLATE().map((i) => (i.key === 'pickem' ? { ...i, complete: true } : i));
  assert.equal(playLobby(done, { now: NOW, signedIn: true }).cards.find((c) => c.id === 'nfl').move, false);
});

test('SUMMARY: each row in its own words and verb, then the soonest OPEN lock; the Daily says it is open and when it closes', () => {
  const v = playLobby(SLATE(), { now: NOW, signedIn: true });
  const nfl = v.cards.find((c) => c.id === 'nfl').summary;
  assert.deepEqual(nfl.parts.map((p) => p.text), ['The Weekly · 6 of 6 set', "Pick'em · 3 of 16 picked"]);
  assert.equal(nfl.nextLock, at(5 * H), 'the soonest lock, not the first row\'s');
  const mlb = v.cards.find((c) => c.id === 'mlb').summary;
  assert.deepEqual(mlb.parts.map((p) => p.text), ['October · 0 of 5 picked', 'The Run locked']);
  const cfb = v.cards.find((c) => c.id === 'cfb').summary;
  assert.deepEqual(cfb.parts, [{ key: 'cfb', text: "Pick'em opens", opensAt: at(D) }]);
  assert.equal(cfb.nextLock, null);
  const daily = v.cards.find((c) => c.id === ALL_SPORTS_CARD).summary;
  assert.deepEqual(daily.parts, [{ key: 'daily', text: "Today's board is open", closesAt: at(8 * H) }]);
  assert.equal(daily.nextLock, null, 'the Daily closes; it does not "lock"');
  const played = cardSummary([{ key: 'daily', game: 'daily', name: 'The Daily', phase: 'open', complete: true, locksAt: at(H) }]);
  assert.equal(played.parts[0].text, 'Played');
  assert.deepEqual(cardSummary([{ key: 'w', name: 'The Weekly', phase: 'done' }]).parts.map((p) => p.text), ['The Weekly final']);
  assert.deepEqual(cardSummary([{ key: 'd', name: 'The Draft', phase: 'locked' }], { signedIn: false }).parts.map((p) => p.text), ['The Draft'],
    'signed out a row with no lock (Sign in to draft) is not called locked');
});

test('countWords: the verb is the row\'s own; a bare "N of M" is a lineup, and lineups are SET', () => {
  assert.equal(countWords({ status: '2 of 5 picked', progress: { done: 2, total: 5 } }), '2 of 5 picked');
  assert.equal(countWords({ status: '2 of 6', progress: { done: 2, total: 6 } }), '2 of 6 set');
  assert.equal(countWords({ status: '9 of 9 set', progress: { done: 9, total: 9 } }), '9 of 9 set');
  assert.equal(countWords({ status: '1 of 4 series picked', progress: { done: 1, total: 4 } }), '1 of 4 series picked');
  assert.equal(countWords({ status: 'Set six players', progress: null }), null, 'no progress, no count');
});

test('?sport= OPENS ONE CARD and filters nothing; unknown is ALL; the open sport keeps its chip', () => {
  const items = SLATE();
  const all = playLobbyOpen(items, { now: NOW, signedIn: true, open: undefined });
  assert.equal(all.open, 'all');
  const nfl = playLobbyOpen(items, { now: NOW, signedIn: true, open: 'NFL' });
  assert.equal(nfl.open, 'nfl');
  assert.equal(nfl.chip, 'nfl');
  assert.deepEqual(nfl.cards.map((c) => c.id), all.cards.map((c) => c.id), 'every card stays');
  assert.deepEqual(nfl.yourMove.map((m) => m.key), all.yourMove.map((m) => m.key), 'YOUR MOVE is not filtered');
  const nba = playLobbyOpen(items, { now: NOW, signedIn: true, open: 'nba' });
  assert.equal(nba.open, 'nba');
  assert.ok(nba.chips.includes('nba'));
  const daily = playLobbyOpen(items, { now: NOW, signedIn: true, open: ALL_SPORTS_CARD });
  assert.equal(daily.open, ALL_SPORTS_CARD);
  assert.equal(daily.chip, 'all');
  assert.equal(playLobbyOpen(items, { now: NOW, open: 'hockey' }).open, 'all');
  assert.equal(normalizeOpen('epl', ['nfl']), 'all', 'a sport with no card opens nothing');
});
