// lib/push/liveActivityState.test.mjs - ONE builder for the NINE fields and
// one for the deep link. Pure: no database, no network, no window.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentState, stateFromMatch, liveLine, gameUrlFor, SITE_ORIGIN } from './liveActivityState.js';
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

test('a game page game becomes exactly the nine fields', () => {
  // WITHOUT A LINE THE LAST THREE ARE BLANK, and that is the honest answer for
  // a caller holding the game but not the play feed - not a reason to invent a
  // thinner reader inside stateFromMatch.
  assert.deepEqual(stateFromMatch(GAME), {
    awayAbbr: 'IND', awayScore: 7, homeAbbr: 'KC', homeScore: 14, period: 'Q2', clock: '1:39',
    possession: '', situation: '', lastPlay: '',
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
  // The game object carries ids, colors, a box score and a status. A tenth
  // field reaching the widget is a contract change, not a convenience.
  const s = stateFromMatch({ ...GAME, boxScore: [{ big: true }], venue: 'Arrowhead' });
  assert.deepEqual(Object.keys(s).sort(), ['awayAbbr', 'awayScore', 'clock', 'homeAbbr', 'homeScore', 'lastPlay', 'period', 'possession', 'situation']);
});

test('a scheduled game is zeroes and empty strings, not nulls', () => {
  // There is no honest scoreline before kickoff, and the widget's Int fields
  // cannot hold "nothing" - a null there is a decode failure, which shows up
  // as a card that silently stops moving.
  const s = stateFromMatch({
    ...GAME, status: 'scheduled', awayScore: null, homeScore: null, liveState: null,
  });
  assert.deepEqual(s, { awayAbbr: 'IND', awayScore: 0, homeAbbr: 'KC', homeScore: 0,
    period: '', clock: '', possession: '', situation: '', lastPlay: '' });
  assert.equal(typeof s.awayScore, 'number');
});

test('a missing team does not throw, it just has no abbreviation', () => {
  const s = stateFromMatch({ ...GAME, home: null });
  assert.equal(s.homeAbbr, '');
  assert.equal(s.awayAbbr, 'IND');
});

test('stateFromMatch of nothing is still the nine', () => {
  assert.deepEqual(stateFromMatch(undefined), {
    awayAbbr: '', awayScore: 0, homeAbbr: '', homeScore: 0, period: '', clock: '',
    possession: '', situation: '', lastPlay: '',
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


// ---------------------------------------------------------------------------
// THE LIVE LINE (LIVE ACTIVITY - THE LIVE LINE relay)
// ---------------------------------------------------------------------------

const ABBR = new Map([[48056, 'KC'], [48074, 'IND']]);
const play = (o = {}) => ({
  driveNumber: 1, playNumber: 1, period: 2, clock: '1:39',
  down: 3, distance: 7, yardsToGoal: 34, offenseTeamId: 48056,
  playType: 'pass', text: 'Mahomes pass complete to Kelce for 8 yards', ...o,
});

test('the three fields, from the plays the game page reads', () => {
  const line = liveLine({
    plays: [play({ playNumber: 1, text: 'Pacheco run for 3' }), play({ playNumber: 2 })],
    homeTeamId: 48056, teamAbbr: ABBR,
  });
  assert.equal(line.possession, 'KC', "the offence's abbreviation, not a side name");
  // yardsToGoal 34 is the DEFENCE's half, so the spot wears their letters.
  assert.equal(line.situation, '3rd & 7 · IND 34');
  assert.equal(line.lastPlay, 'Mahomes pass complete to Kelce for 8 yards');
});

test('NO PLAYS IS THREE EMPTY STRINGS, never a null and never a guess', () => {
  assert.deepEqual(liveLine({ plays: [], homeTeamId: 48056, teamAbbr: ABBR }),
    { possession: '', situation: '', lastPlay: '' });
  assert.deepEqual(liveLine(), { possession: '', situation: '', lastPlay: '' });
  // and the whole state stays decodable: nine keys, right types
  const s = stateFromMatch(GAME, liveLine());
  assert.equal(s.possession, ''); assert.equal(s.situation, ''); assert.equal(s.lastPlay, '');
  assert.equal(typeof s.lastPlay, 'string');
});

test('A STOPPAGE IS NOT A SNAP, which is the whole reason there are two readers', () => {
  // BDL files a timeout with the down and distance and start_yards_to_endzone
  // 0. Read as a snap that is "4th & G at the goal line" - served exactly that
  // way on 9 Sep - for a game sitting at midfield.
  const line = liveLine({
    plays: [
      play({ playNumber: 1, down: 2, distance: 6, yardsToGoal: 41, text: 'Hunt run for 5' }),
      play({ playNumber: 2, playType: 'timeout', down: 4, distance: 1, yardsToGoal: 0, text: 'Timeout KC' }),
    ],
    homeTeamId: 48056, teamAbbr: ABBR,
  });
  assert.equal(line.situation, '2nd & 6 · IND 41', 'the snap is the last REAL play');
  assert.equal(/4th & G/.test(line.situation), false);
  assert.equal(line.lastPlay, 'Hunt run for 5', 'and the words skip the stoppage too');
});

test('goal to go says G, and midfield says 50', () => {
  const g = liveLine({ plays: [play({ down: 1, distance: 8, yardsToGoal: 6 })], homeTeamId: 48056, teamAbbr: ABBR });
  assert.equal(g.situation, '1st & G · IND 6');
  const mid = liveLine({ plays: [play({ down: 2, distance: 10, yardsToGoal: 50 })], homeTeamId: 48056, teamAbbr: ABBR });
  assert.equal(mid.situation, '2nd & 10 · 50');
});

test('the AWAY side on offence wears its own letters, and the spot wears the home side\'s', () => {
  const line = liveLine({
    plays: [play({ offenseTeamId: 48074, yardsToGoal: 22 })],
    homeTeamId: 48056, teamAbbr: ABBR,
  });
  assert.equal(line.possession, 'IND');
  assert.equal(line.situation, '3rd & 7 · KC 22');
});

test('a play with no down is between snaps: words but no situation', () => {
  const line = liveLine({
    plays: [play({ down: null, distance: null, yardsToGoal: null, text: 'End of the third quarter' })],
    homeTeamId: 48056, teamAbbr: ABBR,
  });
  assert.equal(line.situation, '', 'nothing is guessed');
  assert.equal(line.lastPlay, 'End of the third quarter');
});

test('THE LINE RIDES stateFromMatch, so one card is built one way', () => {
  const line = liveLine({ plays: [play()], homeTeamId: 48056, teamAbbr: ABBR });
  const s = stateFromMatch(GAME, line);
  assert.deepEqual(s, {
    awayAbbr: 'IND', awayScore: 7, homeAbbr: 'KC', homeScore: 14, period: 'Q2', clock: '1:39',
    possession: 'KC', situation: '3rd & 7 · IND 34',
    lastPlay: 'Mahomes pass complete to Kelce for 8 yards',
  });
});
