// lib/gridiron/scoresV2Shape.test.mjs - the Scores tab v2 shapes (SCORES TAB v2, item 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abbrOf, viewerDay, shiftDay, dayStripDays, dayCounts, countLine, groupGames, pickState, pickTone, cardVariant, mineCount, hasStake, driveStripFor, statLineText, oddsLine, eplBar } from './scoresV2Shape.js';
import { stakeForMatches } from './scoresV2.js';

const PT = 'America/Los_Angeles';
const g = (id, league, status, kickoffAt, home, away, hs = null, as = null) => ({ id, leagueSlug: league, status, kickoffAt, homeScore: hs, awayScore: as,
  home: { id: home.id, abbreviation: home.ab, name: home.ab }, away: { id: away.id, abbreviation: away.ab, name: away.ab } });
const T = (id, ab) => ({ id, ab });
// a fixture week around Sat Sep 12 2026, in Pacific time
const WEEK = [
  g(1, 'nfl', 'final', '2026-09-11T00:15:00Z', T(1, 'LAR'), T(2, 'SF'), 7, 27),          // Thu night PT
  g(2, 'cfb', 'final', '2026-09-11T23:00:00Z', T(3, 'NCSU'), T(4, 'RICH'), 38, 3),        // Fri PT
  g(3, 'cfb', 'live', '2026-09-12T23:30:00Z', T(5, 'ALA'), T(6, 'USF'), 24, 10),          // Sat live
  g(4, 'cfb', 'live', '2026-09-12T23:30:00Z', T(7, 'TEX'), T(8, 'OSU'), 10, 7),
  g(5, 'epl', 'live', '2026-09-12T16:30:00Z', T(9, 'BRE'), T(10, 'BOU'), 1, 1),
  g(6, 'nfl', 'scheduled', '2026-09-13T17:00:00Z', T(11, 'TEN'), T(12, 'DEN')),           // Sun
  g(7, 'nfl', 'scheduled', '2026-09-13T20:25:00Z', T(13, 'LAC'), T(14, 'KC')),
  g(8, 'nfl', 'scheduled', '2026-09-15T00:15:00Z', T(15, 'CHI'), T(16, 'MIN')),           // Mon night PT
  g(9, 'epl', 'scheduled', '2026-09-15T19:00:00Z', T(17, 'ARS'), T(18, 'CHE')),          // Tue
];
const NOW = '2026-09-12T23:40:00Z';  // Sat 4:40 PM PT

test('viewer days: Thursday night ET is still Thursday in Pacific; the strip is seven days centred on today', () => {
  assert.equal(viewerDay('2026-09-11T00:15:00Z', PT), '2026-09-10');
  assert.equal(viewerDay('2026-09-11T00:15:00Z', 'America/New_York'), '2026-09-10');
  assert.equal(viewerDay('2026-09-11T03:59:00Z', 'America/New_York'), '2026-09-10');
  assert.equal(viewerDay('2026-09-11T04:01:00Z', 'America/New_York'), '2026-09-11');
  assert.equal(shiftDay('2026-09-12', 1), '2026-09-13'); assert.equal(shiftDay('2026-09-01', -1), '2026-08-31');
  const days = dayStripDays('2026-09-12');
  assert.deepEqual(days.map((d) => d.date), ['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15']);
  assert.deepEqual(days.map((d) => d.dow), ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']);
  assert.equal(days[3].isToday, true); assert.equal(days[3].day, 12);
});

test('day counts for the fixture week, and the count lines', () => {
  const c = dayCounts(WEEK, PT);
  assert.deepEqual(c.get('2026-09-10'), { live: 0, final: 1, scheduled: 0, epl: 0 });
  assert.deepEqual(c.get('2026-09-11'), { live: 0, final: 1, scheduled: 0, epl: 0 });
  assert.deepEqual(c.get('2026-09-12'), { live: 3, final: 0, scheduled: 0, epl: 1 });
  assert.deepEqual(c.get('2026-09-13'), { live: 0, final: 0, scheduled: 2, epl: 0 });
  assert.deepEqual(c.get('2026-09-14'), { live: 0, final: 0, scheduled: 1, epl: 0 });
  assert.deepEqual(c.get('2026-09-15'), { live: 0, final: 0, scheduled: 1, epl: 1 });
  assert.deepEqual(countLine(c.get('2026-09-12')), { text: '3 live', live: true });
  assert.deepEqual(countLine(c.get('2026-09-11')), { text: '1 final', live: false });
  assert.deepEqual(countLine(c.get('2026-09-13')), { text: '2 games', live: false });
  assert.deepEqual(countLine(c.get('2026-09-15')), { text: 'EPL', live: false });
  assert.deepEqual(countLine({ live: 0, final: 2, scheduled: 3, epl: 0 }), { text: '2 final · 3 games', live: false });
  assert.deepEqual(countLine(null), { text: 'no games', live: false });
});

test('groups: Live now first (every live game, whatever day), then the day, then Final; empties omitted', () => {
  const sat = groupGames(WEEK, { date: '2026-09-12', today: '2026-09-12', tz: PT, signedIn: true });
  assert.deepEqual(sat.map((x) => [x.key, x.title, x.games.length]), [['live', 'Live now', 3]]);
  assert.equal(sat[0].sub, 'updates every 30s');
  const sun = groupGames(WEEK, { date: '2026-09-13', today: '2026-09-12', tz: PT, signedIn: true });
  assert.deepEqual(sun.map((x) => [x.key, x.title, x.games.length]), [['live', 'Live now', 3], ['day', 'Tomorrow · Sunday', 2]]);
  assert.equal(sun[1].sub, '2 games · your picks lock at kick');
  assert.equal(groupGames(WEEK, { date: '2026-09-13', today: '2026-09-12', tz: PT, signedIn: false })[1].sub, '2 games');
  const fri = groupGames(WEEK, { date: '2026-09-11', today: '2026-09-12', tz: PT });
  assert.deepEqual(fri.map((x) => [x.key, x.title, x.games.length]), [['live', 'Live now', 3], ['final', 'Final', 1]]);
  assert.equal(fri[1].sub, 'Fri');
  const tue = groupGames(WEEK, { date: '2026-09-15', today: '2026-09-12', tz: PT, sport: 'epl' });
  assert.deepEqual(tue.map((x) => [x.key, x.title, x.games.map((y) => y.id)]), [['live', 'Live now', [5]], ['day', 'Tuesday · Sep 15', [9]]]);
  // an empty day: nothing but the live group; a quiet week with no live games -> []
  assert.deepEqual(groupGames(WEEK.filter((x) => x.status !== 'live'), { date: '2026-09-16', today: '2026-09-12', tz: PT }), []);
});

test('pick state and tone: winning / losing / won / lost / tied / push / pending', () => {
  assert.equal(pickState({ side: 'home', homeScore: 24, awayScore: 10, status: 'live' }), 'winning');
  assert.equal(pickState({ side: 'away', homeScore: 24, awayScore: 10, status: 'live' }), 'losing');
  assert.equal(pickState({ side: 'home', homeScore: 38, awayScore: 3, status: 'final' }), 'won');
  assert.equal(pickState({ side: 'away', homeScore: 38, awayScore: 3, status: 'final' }), 'lost');
  assert.equal(pickState({ side: 'home', homeScore: 1, awayScore: 1, status: 'live' }), 'tied');
  assert.equal(pickState({ side: 'home', homeScore: 1, awayScore: 1, status: 'final' }), 'push');
  assert.equal(pickState({ side: 'home', homeScore: null, awayScore: null, status: 'scheduled' }), 'pending');
  assert.equal(pickState({ side: null }), null);
  assert.equal(pickTone('won'), 'good'); assert.equal(pickTone('losing'), 'bad'); assert.equal(pickTone('pending'), '');
  assert.deepEqual(WEEK.slice(0, 6).map(cardVariant), ['final', 'final', 'live', 'live', 'live', 'upcoming']);
});

test('stakeForMatches on fixtures: pick states, two Weekly players, alerts via match and via team, none', async () => {
  const calls = [];
  const db = async (strings, ...vals) => {
    const q = strings.join('?'); calls.push(q);
    if (/FROM contest_entries/.test(q)) return [{ lineup: { 3: 'home', 4: 'away', 2: 'home', 6: 'away' } }];
    if (/FROM alert_prefs/.test(q)) return [{ scope: 'match', scope_id: 3 }, { scope: 'team', scope_id: 12 }];
    return [];
  };
  const weeklyRows = [
    { slot: 'QB', id: 101, name: 'Bo Nix', team: 'DEN', points: 0 },
    { slot: 'WR', id: 102, name: 'Courtland Sutton', team: 'DEN', points: 0 },
    { slot: 'FLEX2', id: 103, name: 'Puka Nacua', team: 'LAR', points: 12.4 },
  ];
  const m = await stakeForMatches(7, WEEK, { db, weeklyRows });
  assert.equal(calls.length, 2, 'two queries for the whole slate, not per card');
  assert.deepEqual(m.get(3), { pick: { side: 'home', abbr: 'ALA', state: 'winning' }, weekly: [], alerts: true }, 'alert via the match row');
  assert.deepEqual(m.get(4), { pick: { side: 'away', abbr: 'OSU', state: 'losing' }, weekly: [], alerts: false });
  assert.deepEqual(m.get(2), { pick: { side: 'home', abbr: 'NCSU', state: 'won' }, weekly: [], alerts: false });
  assert.deepEqual(m.get(6), { pick: { side: 'away', abbr: 'DEN', state: 'pending' },
    weekly: [{ name: 'Bo Nix', pos: 'QB', points: 0 }, { name: 'Courtland Sutton', pos: 'WR', points: 0 }], alerts: true }, 'two Weekly players and an alert via the team');
  assert.deepEqual(m.get(1), { pick: null, weekly: [{ name: 'Puka Nacua', pos: 'FLEX', points: 12.4 }], alerts: false }, 'a Weekly player alone is a stake');
  assert.equal(m.get(7), undefined, 'none -> no entry');
  assert.equal(m.get(9), undefined, 'EPL never carries Weekly players');
  assert.equal(mineCount(WEEK, m), 5); assert.equal(hasStake(m.get(6)), true); assert.equal(hasStake(null), false);
  assert.equal((await stakeForMatches(null, WEEK, { db, weeklyRows })).size, 0, 'signed out -> nothing');
});

test('the drive strip from the latest down-bearing play; nothing without a down', () => {
  const game = WEEK[2];   // ALA (home) v USF
  const d = driveStripFor({ play: { down: 2, distance: 6, yardsToGoal: 59, offenseTeamId: 5, text: 'run for 3' }, lastText: 'J. Milroe pass short right to G. Bernard for 9 yards.', game });
  assert.deepEqual(d, { label: '2nd & 6', spot: 'ALA 41', offenseAbbr: 'ALA', pct: 41, lastPlay: 'J. Milroe pass short right to G. Bernard for 9 yards.' });
  const goal = driveStripFor({ play: { down: 1, distance: 10, yardsToGoal: 4, offenseTeamId: 6 }, game });
  assert.equal(goal.label, '1st & G'); assert.equal(goal.spot, 'ALA 4'); assert.equal(goal.offenseAbbr, 'USF'); assert.equal(goal.pct, 96);
  // GO rider: a defense with no abbreviation still yields "<derived> <yardline>"
  const howard = { ...WEEK[2], home: { id: 5, abbreviation: 'IU', name: 'Indiana' }, away: { id: 6, abbreviation: null, name: 'Howard', shortName: 'Howard' } };
  const fcs = driveStripFor({ play: { down: 1, distance: 10, yardsToGoal: 43, offenseTeamId: 5 }, game: howard });
  assert.equal(fcs.spot, 'HOW 43'); assert.equal(fcs.offenseAbbr, 'IU');
  const fcsBall = driveStripFor({ play: { down: 2, distance: 4, yardsToGoal: 70, offenseTeamId: 6 }, game: howard });
  assert.equal(fcsBall.spot, 'HOW 30'); assert.equal(fcsBall.offenseAbbr, 'HOW');
  assert.equal(abbrOf({ abbreviation: null, name: 'Norfolk State' }), 'NOR'); assert.equal(abbrOf({ abbreviation: 'UVA' }), 'UVA');
  assert.equal(driveStripFor({ play: { down: null }, game }), null);
  assert.equal(driveStripFor({ play: null, game }), null);
});

test('the stat line, the odds foot, the EPL bar', () => {
  assert.equal(statLineText({ name: 'Brock Purdy', passCmp: 25, passAtt: 34, passYds: 205, passTd: 3 }, 'nfl'), 'Purdy 25/34 · 205 · 3 TD');
  assert.equal(statLineText({ name: 'CJ Bailey', passCmp: 13, passAtt: 17, passYds: 281, passTd: 1 }, 'cfb'), 'Bailey 13/17 · 281 · 1 TD');
  assert.equal(statLineText({ name: 'A B', passCmp: 1, passAtt: 2, passYds: 9, passTd: 0 }, 'nfl'), 'B 1/2 · 9');
  assert.equal(statLineText({ scorers: [{ name: 'Haaland', goals: 2 }, { name: 'Foden', goals: 1 }] }, 'epl'), 'Haaland 2, Foden 1');
  assert.equal(statLineText(null, 'nfl'), null); assert.equal(statLineText({ scorers: [] }, 'epl'), null);
  // R3: a leader with 0 in the stat -> no line
  assert.equal(statLineText({ name: 'A B', passCmp: 0, passAtt: 3, passYds: 0, passTd: 0 }, 'nfl'), null);
  assert.equal(statLineText({ scorers: [{ name: 'X', goals: 0 }] }, 'epl'), null);
  assert.equal(oddsLine(WEEK[5], -5.5, 43.5), 'Spread TEN -5.5 · O/U 43.5');
  assert.equal(oddsLine(WEEK[5], 2.5, null), 'Spread DEN -2.5');
  assert.equal(oddsLine(WEEK[5], null, null), null);
  assert.deepEqual(eplBar({ home: 54.2, draw: 24, away: 21.8 }, WEEK[4]), { abbr: 'BRE', pct: 54 });
  assert.deepEqual(eplBar({ home: 30, draw: 20, away: 50 }, WEEK[4]), { abbr: 'BOU', pct: 50 });
  assert.equal(eplBar(null, WEEK[4]), null);
});
