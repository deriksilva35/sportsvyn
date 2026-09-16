// lib/push/liveActivityState.test.mjs - ONE builder for the six fields and
// one for the deep link. Pure: no database, no network, no window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentState, stateFromMatch, gameUrlFor, SITE_ORIGIN } from './liveActivityState.js';
import { contentState as reExported } from './liveActivity.js';

const GAME = {
  id: 21569,
  slug: 'nfl-2026-reg-w2-ind-kc',
  leagueSlug: 'nfl',
  status: 'live',
  awayScore: 7,
  homeScore: 14,
  liveState: { period: 2, clock: '1:39' },   // the stored shape: an INTEGER
  away: { id: 48074, name: 'Indianapolis Colts', abbreviation: 'IND' },
  home: { id: 48056, name: 'Kansas City Chiefs', abbreviation: 'KC' },
};

test('a game page game becomes exactly the six fields', () => {
  assert.deepEqual(stateFromMatch(GAME), {
    awayAbbr: 'IND', awayScore: 7, homeAbbr: 'KC', homeScore: 14, period: 'Q2', clock: '1:39',
  });
});

test('THE PERIOD IS THE LABEL, not the integer the column holds', () => {
  // live_state.period is 1..4 and 5 for OT. A raw pass-through puts "2" on the
  // lock screen, which reads as a bug in the app rather than a bug here.
  assert.equal(stateFromMatch({ ...GAME, liveState: { period: 4, clock: '0:09' } }).period, 'Q4');
  assert.equal(stateFromMatch({ ...GAME, liveState: { period: 5, clock: '4:20' } }).period, 'OT');
  // Halftime is period 2 with a zeroed clock - a sustained state, and shortOf
  // already says so for every other surface.
  assert.equal(stateFromMatch({ ...GAME, liveState: { period: 2, clock: '0:00' } }).period, 'HT');
});

test('nothing else on the game gets through', () => {
  // The game object carries ids, colors, a box score and a status. A seventh
  // field reaching the widget is a contract change, not a convenience.
  const s = stateFromMatch({ ...GAME, boxScore: [{ big: true }], venue: 'Arrowhead' });
  assert.deepEqual(Object.keys(s).sort(), ['awayAbbr', 'awayScore', 'clock', 'homeAbbr', 'homeScore', 'period']);
});

test('a scheduled game is zeroes and empty strings, not nulls', () => {
  // There is no honest scoreline before kickoff, and the widget's Int fields
  // cannot hold "nothing" - a null there is a decode failure, which shows up
  // as a card that silently stops moving.
  const s = stateFromMatch({
    ...GAME, status: 'scheduled', awayScore: null, homeScore: null, liveState: null,
  });
  assert.deepEqual(s, { awayAbbr: 'IND', awayScore: 0, homeAbbr: 'KC', homeScore: 0, period: '', clock: '' });
  assert.equal(typeof s.awayScore, 'number');
});

test('a missing team does not throw, it just has no abbreviation', () => {
  const s = stateFromMatch({ ...GAME, home: null });
  assert.equal(s.homeAbbr, '');
  assert.equal(s.awayAbbr, 'IND');
});

test('stateFromMatch of nothing is still the six', () => {
  assert.deepEqual(stateFromMatch(undefined), {
    awayAbbr: '', awayScore: 0, homeAbbr: '', homeScore: 0, period: '', clock: '',
  });
});

test('THE SAME BUILDER the push path uses - not a copy of it', () => {
  // liveActivity.js re-exports contentState from here. If someone gives the
  // sender its own six, this fails.
  assert.equal(reExported, contentState);
});

test('the deep link is absolute, and carries the slug whole', () => {
  assert.equal(gameUrlFor(GAME), 'https://sportsvyn.com/nfl/game/nfl-2026-reg-w2-ind-kc');
  assert.equal(SITE_ORIGIN, 'https://sportsvyn.com');
});

test('a CFB game links to the CFB route, not the NFL one', () => {
  // app/cfb/game/[slug] is a real route; /nfl/game/<cfb-slug> is a 404, and a
  // static attribute cannot be corrected after the Activity starts.
  assert.equal(
    gameUrlFor({ slug: 'cfb-2026-reg-w3-lsu-ole-miss', leagueSlug: 'cfb' }),
    'https://sportsvyn.com/cfb/game/cfb-2026-reg-w3-lsu-ole-miss',
  );
});

test('no slug means no url, rather than a link to nowhere', () => {
  assert.equal(gameUrlFor({ leagueSlug: 'nfl' }), null);
  assert.equal(gameUrlFor(null), null);
});
