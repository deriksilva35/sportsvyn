// lib/market/propLinking.test.mjs — the linking engine's rules, each pinned to
// a case measured on live vendor rows rather than invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveProp, buildRosterIndex, normalizeLabel, stripSide, surnameOf,
  isTeamSelection, AMBIGUOUS,
} from './propLinking.js';

const P = (id, full_name) => ({ id, full_name });
const ix = (...players) => buildRosterIndex(players);

// ---------------------------------------------------------------------------
// EXACT
// ---------------------------------------------------------------------------

test('exact normalized match wins', () => {
  const home = ix(P(1, 'John McGinn'), P(2, 'Ollie Watkins'));
  assert.deepEqual(resolveProp('John McGinn', home), { playerId: 1, how: 'exact' });
});

test('normalization handles accents, periods and generational suffixes', () => {
  assert.equal(normalizeLabel('Francisco Evanilson de Lima Barbosa'), 'francisco evanilson de lima barbosa');
  assert.equal(normalizeLabel("DeAngelo Irvin Jr."), 'deangelo irvin');
  assert.equal(normalizeLabel('A. Dedić'), 'a dedic');
  // A real live label, accents and all.
  const r = ix(P(7, 'Gonzalo García'));
  assert.deepEqual(resolveProp('Gonzalo Garcia', r), { playerId: 7, how: 'exact' });
});

// ---------------------------------------------------------------------------
// O/U SUFFIX
// ---------------------------------------------------------------------------

test('the Over/Under side is stripped before matching', () => {
  assert.equal(stripSide('Mikkel Damsgaard Over'), 'Mikkel Damsgaard');
  assert.equal(stripSide('Sam Darnold Under'), 'Sam Darnold');
  const r = ix(P(3, 'Mikkel Damsgaard'));
  assert.deepEqual(resolveProp('Mikkel Damsgaard Over', r), { playerId: 3, how: 'exact' });
  assert.deepEqual(resolveProp('Mikkel Damsgaard Under', r), { playerId: 3, how: 'exact' });
});

test('a surname that IS "Over" is not eaten', () => {
  // Only a TRAILING side token is a side. "Over" mid-name is a name.
  assert.equal(stripSide('Over Land'), 'Over Land');
});

// ---------------------------------------------------------------------------
// THE M. GUSTO CASE — the reason the fallback exists
// ---------------------------------------------------------------------------

test('"M. Gusto" (our squad) links to "Malo Gusto" (the vendor)', () => {
  // API-Sports writes the initial; The Odds API writes the given name. Exact
  // matching linked 7.7% of EPL rows because of exactly this.
  const chelsea = ix(P(11, 'M. Gusto'), P(12, 'Pedro Neto'));
  assert.equal(normalizeLabel('M. Gusto'), 'm gusto');
  assert.equal(surnameOf(normalizeLabel('M. Gusto')), 'gusto');
  assert.equal(surnameOf(normalizeLabel('Malo Gusto')), 'gusto');
  assert.deepEqual(resolveProp('Malo Gusto', chelsea), { playerId: 11, how: 'surname' });
});

test('EXACT BEATS SURNAME, even across the two rosters', () => {
  // An exact hit on the away side must never lose to a surname hit at home.
  const home = ix(P(1, 'Danny Welbeck'));
  const away = ix(P(2, 'Jack Welbeck'), P(3, 'Danny Welbeck'));
  // 'welbeck' is ambiguous on the away roster, but the exact name resolves.
  assert.deepEqual(resolveProp('Danny Welbeck', [home, away]), { playerId: 1, how: 'exact' });
});

// ---------------------------------------------------------------------------
// AMBIGUITY -> NO LINK
// ---------------------------------------------------------------------------

test('two players sharing a surname on one roster resolve to NOTHING', () => {
  // A linked row grows a chart and a hit-rate line. Attaching those to the
  // wrong brother is a confident lie, which is worse than an absent one.
  const r = ix(P(1, 'Jason Kelce'), P(2, 'Travis Kelce'));
  assert.equal(r.surname.get('kelce'), AMBIGUOUS);
  assert.equal(resolveProp('T. Kelce', r), null);
  // The full name still resolves - ambiguity only blocks the fallback.
  assert.deepEqual(resolveProp('Travis Kelce', r), { playerId: 2, how: 'exact' });
});

test('the same surname on BOTH rosters is ambiguous across the event', () => {
  const home = ix(P(1, 'Alan Smith'));
  const away = ix(P(2, 'Brian Smith'));
  assert.equal(resolveProp('Charlie Smith', [home, away]), null,
    'neither roster alone says ambiguous, but the event does');
});

// ---------------------------------------------------------------------------
// D/ST — a market-scope class, not a miss
// ---------------------------------------------------------------------------

test('team defense labels are excluded before matching', () => {
  assert.ok(isTeamSelection('Carolina Panthers D/ST'));
  assert.equal(resolveProp('Carolina Panthers D/ST', ix(P(1, 'Carolina Panthers'))), null,
    'even a player row of that exact name must not catch it');
});

// ---------------------------------------------------------------------------
// THE CONSTRAINED SPACE — the safety guarantee
// ---------------------------------------------------------------------------

test('a name on some OTHER roster does not match', () => {
  // Surname matching is only defensible because the space is ~70 players who
  // could appear in this game. This is the assertion that says so.
  const eventRosters = [ix(P(1, 'John McGinn')), ix(P(2, 'Ollie Watkins'))];
  assert.equal(resolveProp('Erling Haaland', eventRosters), null);
  assert.equal(resolveProp('Haaland', eventRosters), null);
});

test('empty and junk labels resolve to null, never to the first player', () => {
  const r = ix(P(1, 'John McGinn'));
  for (const bad of ['', '   ', null, undefined, 'Over', '—']) {
    assert.equal(resolveProp(bad, r), null, `${JSON.stringify(bad)} must not link`);
  }
});

test('an empty roster resolves nothing', () => {
  assert.equal(resolveProp('John McGinn', buildRosterIndex([])), null);
  assert.equal(resolveProp('John McGinn', []), null);
});
