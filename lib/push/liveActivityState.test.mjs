// lib/push/liveActivityState.test.mjs - ONE builder for the TEN fields and
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
  kickoffAt: '2026-09-13T17:00:00.000Z',
  liveState: { period: 2, clock: '1:39' },   // the stored shape: an INTEGER
  away: { id: 48074, name: 'Indianapolis Colts', abbreviation: 'IND' },
  home: { id: 48056, name: 'Kansas City Chiefs', abbreviation: 'KC' },
};

test('a game page game becomes exactly the ten fields', () => {
  // WITHOUT A LINE THE LAST THREE ARE BLANK, and that is the honest answer for
  // a caller holding the game but not the play feed - not a reason to invent a
  // thinner reader inside stateFromMatch.
  assert.deepEqual(stateFromMatch(GAME), {
    awayAbbr: 'IND', awayScore: 7, homeAbbr: 'KC', homeScore: 14, period: 'Q2', clock: '1:39',
    possession: '', situation: '', lastPlay: '', kickoffAt: '2026-09-13T17:00:00.000Z',
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
  // The game object carries ids, colors, a box score and a status. An eleventh
  // field reaching the widget is a contract change, not a convenience.
  const s = stateFromMatch({ ...GAME, boxScore: [{ big: true }], venue: 'Arrowhead' });
  assert.deepEqual(Object.keys(s).sort(), ['awayAbbr', 'awayScore', 'clock', 'homeAbbr', 'homeScore', 'kickoffAt', 'lastPlay', 'period', 'possession', 'situation']);
});

test('a scheduled game is zeroes and empty strings, not nulls', () => {
  // There is no honest scoreline before kickoff, and the widget's Int fields
  // cannot hold "nothing" - a null there is a decode failure, which shows up
  // as a card that silently stops moving.
  const s = stateFromMatch({
    ...GAME, status: 'scheduled', awayScore: null, homeScore: null, liveState: null,
  });
  // THE KICKOFF SURVIVES A SCHEDULED GAME - it is the one field that is MORE
  // useful before the game than during it, which is the whole reason for it.
  assert.deepEqual(s, { awayAbbr: 'IND', awayScore: 0, homeAbbr: 'KC', homeScore: 0,
    period: '', clock: '', possession: '', situation: '', lastPlay: '',
    kickoffAt: '2026-09-13T17:00:00.000Z' });
  assert.equal(typeof s.awayScore, 'number');
});

test('a missing team does not throw, it just has no abbreviation', () => {
  const s = stateFromMatch({ ...GAME, home: null });
  assert.equal(s.homeAbbr, '');
  assert.equal(s.awayAbbr, 'IND');
});

test('stateFromMatch of nothing is still the ten', () => {
  assert.deepEqual(stateFromMatch(undefined), {
    awayAbbr: '', awayScore: 0, homeAbbr: '', homeScore: 0, period: '', clock: '',
    possession: '', situation: '', lastPlay: '', kickoffAt: '',
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
    kickoffAt: '2026-09-13T17:00:00.000Z',
  });
});

// ---------------------------------------------------------------------------
// A TEAM WITH NO ABBREVIATION (Portland State at Oregon, 18 Sep)
// ---------------------------------------------------------------------------

test('a side with no abbreviation resolves, it does not go blank', () => {
  // 105 of 243 CFB teams have no `abbreviation`. Reading the column directly
  // built a card whose away side was an empty string - " 0, ORE 0" - for a
  // game on the schedule tonight.
  const s = stateFromMatch({
    ...GAME,
    away: { id: 48265, name: 'Portland State', short_name: 'Portland State', abbreviation: null },
    home: { id: 48174, name: 'Oregon', short_name: 'Oregon', abbreviation: 'ORE' },
  });
  assert.equal(s.awayAbbr, 'Portland State', "short_name is resolveAbbr's second source");
  assert.equal(s.homeAbbr, 'ORE', 'and a real abbreviation still wins');
});

test('with no short_name either, it derives - and never returns null', () => {
  const s = stateFromMatch({
    ...GAME,
    away: { id: 1, name: 'Portland State', abbreviation: null },
    home: { id: 2, name: 'Texas A&M', abbreviation: null },
  });
  assert.equal(s.awayAbbr, 'PS');
  assert.equal(s.homeAbbr, 'TAM');
  // contentState's str() turns a null from resolveAbbr into '', never null -
  // the widget's field cannot hold nothing.
  const none = stateFromMatch({ ...GAME, away: { id: 3 }, home: { id: 4 } });
  assert.equal(none.awayAbbr, '');
  assert.equal(typeof none.awayAbbr, 'string');
});

test('THE ONE RULE, not a second one: the same helper every other surface reads', async () => {
  const { abbrOf } = await import('../live/teamAbbr.js');
  const team = { name: 'Portland State', short_name: 'Portland State', abbreviation: null };
  assert.equal(stateFromMatch({ ...GAME, away: team }).awayAbbr, abbrOf(team));
});

// --- A BASEBALL CARD'S LINE, AND WHOSE ANSWER IT IS -------------------------

test('a caller may override ONE field of a baseball line and keep the other two', async () => {
  const { stateFromMatch } = await import('./liveActivityState.js');
  const game = {
    slug: 'mlb-2026-09-22-tb-nyy', leagueSlug: 'mlb',
    home: { abbreviation: 'NYY' }, away: { abbreviation: 'TB' },
    homeScore: 2, awayScore: 3, kickoffAt: '2026-09-22T17:05:00Z',
    liveState: { period: 7, half: 'Top', outs: 2, balls: 3, strikes: 2,
      bases: { first: true, second: false, third: true } },
    scoringPlays: [{ text: 'Díaz singled to right, Lowe scored.', inning: '7th', half: 'top' }],
  };
  // NO LINE: everything is derived, as before.
  const derived = stateFromMatch(game);
  assert.equal(derived.possession, 'TB');
  assert.match(derived.situation, /2 out/);
  assert.equal(derived.lastPlay, 'Díaz singled to right, Lowe scored.');

  // ONE FIELD OVERRIDDEN: possession and situation survive. Passing a line used
  // to replace ALL THREE, which is how every MLB card came to be built from the
  // gridiron reader - down, distance and a spot on a field.
  const over = stateFromMatch(game, { lastPlay: 'Realmuto flied out to center.' });
  assert.equal(over.lastPlay, 'Realmuto flied out to center.');
  assert.equal(over.possession, 'TB', 'the batting side is still the batting side');
  assert.equal(over.situation, derived.situation);
});

test('THE LAST PLAY IS TEXTURE, so it coalesces and never pushes on its own', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../services/live-poller/poll.mjs', import.meta.url), 'utf8');
  // NEWS is the score and the period; TEXTURE is the clock and the last play.
  const news = /const news = \[([^\]]+)\]/.exec(src)[1];
  const full = /const full = \[([^\]]+)\]/.exec(src)[1];
  assert.doesNotMatch(news, /lastPlay/, 'a new last play must not push immediately');
  assert.match(full, /lastPlay/, 'but it must still be able to push once the window opens');
  assert.match(full, /news/, 'and the texture key contains the news key');
  // AND THE WINDOW IS THE ONE la-cadence DEFINES, not a second number here.
  assert.match(src, /LA_COALESCE_MS/);
});
