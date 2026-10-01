// lib/nba/card.test.mjs - the NBA card and game page's pure pieces (nba-card, thu-37).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nbaPeriodWord, nbaLiveLabel, nbaFinalLabel, finalPeriodOf, nbaLine, nbaCardExtras, timeoutsText,
  lastPlayText, surname, performerLine, nbaLeaders, nbaTeamStats, minutesOf, nbaBoxTables, nbaWhen,
  nbaPlayRows, nbaModules, nbaChips,
} from './card.js';
import { loadReplay, situationAt, statsAt, rowAt, replaySpan, REPLAY_GAMES } from './replay.js';
import { shapeNbaPlays } from './statsSync.js';
import { nbaYourGames, nbaStripWords, marginWords } from './yours.js';
import { lineFor } from '../scores/expand.js';
import { possessionSide } from '../gridiron/possession.js';

const game = { id: 7, leagueSlug: 'nba', status: 'live', homeScore: 101, awayScore: 104,
  home: { id: 2, abbreviation: 'DET' }, away: { id: 1, abbreviation: 'BOS' } };

test('the live pill: "Q4 · 2:14", "Half", "End Q3", "OT · 0:45", "2OT · 1:02"; nothing readable is "Live"', () => {
  assert.equal(nbaLiveLabel({ period: 4, clock: '2:14' }), 'Q4 · 2:14');
  assert.equal(nbaLiveLabel({ period: 1, clock: '11:47' }), 'Q1 · 11:47');
  assert.equal(nbaLiveLabel({ period: 4, clock: '24.7' }), 'Q4 · 24.7', 'tenths under a minute');
  assert.equal(nbaLiveLabel({ period: 2, clock: '0:00' }), 'Half');
  assert.equal(nbaLiveLabel({ period: 2, clock: '0.0' }), 'Half');
  assert.equal(nbaLiveLabel({ period: 3, clock: '0.0' }), 'End Q3');
  assert.equal(nbaLiveLabel({ period: 5, clock: '0:45' }), 'OT · 0:45');
  assert.equal(nbaLiveLabel({ period: 6, clock: '1:02' }), '2OT · 1:02');
  assert.equal(nbaLiveLabel(null), 'Live');
  assert.equal(nbaLiveLabel({ period: 0, clock: '12:00' }), 'Live');
  assert.equal(nbaPeriodWord(7), '3OT');
});

test('the final pill: "Final", "Final · OT", "Final · 2OT" - the period it ENDED in, off the line score', () => {
  assert.equal(nbaFinalLabel(4), 'Final');
  assert.equal(nbaFinalLabel(5), 'Final · OT');
  assert.equal(nbaFinalLabel(6), 'Final · 2OT');
  assert.equal(nbaFinalLabel(null), 'Final');
  const ls = (k) => Array.from({ length: k }, (_, i) => ({ period: i + 1, home: 20, away: 20 }));
  assert.equal(finalPeriodOf({ line_score: ls(4) }), 4);
  assert.equal(finalPeriodOf({ line_score: ls(6) }), 6);
  assert.equal(finalPeriodOf({}), 4, 'no line stored: regulation, never an invented OT');
});

test('the line score: 1 2 3 4 always, then OT 2OT as played; blanks for unplayed quarters; the total is the row score', () => {
  const live = nbaLine(game, { line_score: [{ period: 1, home: 22, away: 28 }, { period: 2, home: 31, away: 24 }, { period: 3, home: 26, away: 27 }, { period: 4, home: 22, away: 25 }] });
  assert.deepEqual(live.columns, ['1', '2', '3', '4']);
  assert.deepEqual(live.rows.map((r) => r.side), ['away', 'home'], 'away first, the card order');
  assert.deepEqual(live.rows[0].cells, ['28', '24', '27', '25']);
  assert.equal(live.rows[0].total, 104);
  const early = nbaLine(game, { line_score: [{ period: 1, home: 10, away: 12 }] });
  assert.deepEqual(early.rows[1].cells, ['10', '', '', ''], 'Q2-Q4 not yet played are blank, not 0');
  const ot2 = nbaLine(game, { line_score: [1, 2, 3, 4, 5, 6].map((p) => ({ period: p, home: 9, away: 9 })) });
  assert.deepEqual(ot2.columns, ['1', '2', '3', '4', 'OT', '2OT']);
  assert.equal(nbaLine(game, {}), null);
  assert.equal(nbaLine(game, { line_score: [] }), null);
  // lineFor routes basketball here (the drawer and the board read lineFor)
  assert.deepEqual(lineFor({ ...game, detail: { line_score: [{ period: 1, home: 1, away: 2 }] } }).columns, ['1', '2', '3', '4']);
});

test('extras: bonus and timeouts are LIVE facts, both sides or nothing; a final keeps only its period', () => {
  const d = { bonus: { home: false, away: true }, timeouts: { home: 3, away: 2 }, line_score: [1, 2, 3, 4, 5].map((p) => ({ period: p, home: 1, away: 1 })) };
  assert.deepEqual(nbaCardExtras('live', d), { bonus: { home: false, away: true }, timeouts: { home: 3, away: 2 }, finalPeriod: null });
  assert.deepEqual(nbaCardExtras('final', d), { bonus: null, timeouts: null, finalPeriod: 5 });
  assert.deepEqual(nbaCardExtras('live', { bonus: { home: true, away: null }, timeouts: { home: 3 } }), { bonus: null, timeouts: null, finalPeriod: null }, 'half a fact is not drawn');
  assert.equal(timeoutsText({ home: 3, away: 2 }), 'TO 2 · 3', 'away first');
  assert.equal(timeoutsText(null), null);
});

test('NO POSSESSION for basketball: the feed has none and the shared rule answers null', () => {
  assert.equal(possessionSide({ leagueSlug: 'nba', status: 'live', possession: 'BOS', homeAbbr: 'DET', awayAbbr: 'BOS', liveState: { period: 4, clock: '2:14' } }), null);
});

test('the last play: its sentence; period markers are not plays', () => {
  assert.equal(lastPlayText({ last_play: { text: 'Jayson Tatum makes 26-foot three point jumper  (Jaylen Brown assists)', type: 'Jump Shot' } }), 'Jayson Tatum makes 26-foot three point jumper (Jaylen Brown assists)');
  assert.equal(lastPlayText({ last_play: { text: 'End of the 3rd Quarter', type: 'End Period' } }), null);
  assert.equal(lastPlayText({}), null);
});

const BOX = [
  { team_id: 1, player_name: 'Jayson Tatum', pts: 38, reb: 11, ast: 4, fgm: 13, fga: 24, fg3m: 5, fg3a: 11, ftm: 7, fta: 8, turnovers: 3, seconds: 2520, plus_minus: 6, dnp: false },
  { team_id: 1, player_name: 'Derrick White', pts: 12, reb: 4, ast: 9, fgm: 4, fga: 10, fg3m: 2, fg3a: 6, ftm: 2, fta: 2, turnovers: 1, seconds: 2100, plus_minus: 2, dnp: false },
  { team_id: 1, player_name: 'Kristaps Porzingis', pts: 14, reb: 12, ast: 1, fgm: 6, fga: 11, fg3m: 1, fg3a: 3, ftm: 1, fta: 2, turnovers: 0, seconds: 1900, plus_minus: -1, dnp: false },
  { team_id: 1, player_name: 'Bench Guy', pts: 0, reb: 0, ast: 0, seconds: 0, dnp: true },
  { team_id: 2, player_name: 'Cade Cunningham', pts: 34, reb: 6, ast: 11, fgm: 12, fga: 27, fg3m: 2, fg3a: 8, ftm: 8, fta: 9, turnovers: 6, seconds: 2580, plus_minus: -4, dnp: false },
  { team_id: 2, player_name: 'Jalen Duren', pts: 10, reb: 15, ast: 2, fgm: 5, fga: 7, fg3m: 0, fg3a: 0, ftm: 0, fta: 1, turnovers: 2, seconds: 2000, plus_minus: -2, dnp: false },
  { team_id: 2, player_name: 'Jaren Jackson Jr.', pts: 3, reb: 1, ast: 0, fgm: 1, fga: 3, fg3m: 1, fg3a: 2, ftm: 0, fta: 0, turnovers: 0, seconds: 600, plus_minus: 0, dnp: false },
];

test('the foot: live "Tatum 38 pts · Cunningham 34", the higher first; final "Tatum 38 pts · 11 reb"; nobody scored, nothing', () => {
  assert.equal(performerLine(BOX, { status: 'live', homeId: 2, awayId: 1 }), 'Tatum 38 pts · Cunningham 34');
  assert.equal(performerLine(BOX, { status: 'final', homeId: 2, awayId: 1 }), 'Tatum 38 pts · 11 reb');
  const assists = BOX.map((r) => (r.player_name === 'Jayson Tatum' ? { ...r, pts: 20 } : r));
  assert.equal(performerLine(assists, { status: 'final', homeId: 2, awayId: 1 }), 'Cunningham 34 pts · 11 ast', 'the larger of reb and ast');
  const quiet = [{ team_id: 1, player_name: 'A B', pts: 30, reb: 2, ast: 3, dnp: false }];
  assert.equal(performerLine(quiet, { status: 'final', homeId: 2, awayId: 1 }), 'B 30 pts', 'under five of each: points alone');
  assert.equal(performerLine(quiet, { status: 'live', homeId: 2, awayId: 1 }), 'B 30 pts', 'one side scored: one name');
  assert.equal(performerLine([], { status: 'live' }), null);
  assert.equal(performerLine([{ team_id: 1, player_name: 'A B', pts: 0, dnp: false }], { status: 'live', homeId: 2, awayId: 1 }), null);
  assert.equal(surname('Jaren Jackson Jr.'), 'Jackson Jr.');
});

test('leaders PTS / REB / AST both teams; the points line carries the shooting', () => {
  const l = nbaLeaders(BOX, { homeId: 2, awayId: 1 });
  assert.deepEqual(l.map((r) => r.cat), ['PTS', 'REB', 'AST']);
  assert.deepEqual(l[0].away, { name: 'Tatum', line: '38 · 13/24 · 5 3PM' });
  assert.deepEqual(l[0].home, { name: 'Cunningham', line: '34 · 12/27' }, 'two threes: no 3PM bit');
  assert.deepEqual(l[1].away, { name: 'Porzingis', line: '12' });
  assert.deepEqual(l[1].home, { name: 'Duren', line: '15' });
  assert.deepEqual(l[2].away, { name: 'White', line: '9' });
  assert.deepEqual(l[2].home, { name: 'Cunningham', line: '11' });
  assert.deepEqual(nbaLeaders([], { homeId: 2, awayId: 1 }), []);
});

test('team stats FG% / 3PT / REB / TOV, derived from the summed makes and attempts', () => {
  const t = nbaTeamStats(BOX, { homeId: 2, awayId: 1 });
  assert.deepEqual(t[1], { 'FG%': '.511', '3PT': '8/20', REB: 27, TOV: 4 });
  assert.deepEqual(t[2], { 'FG%': '.486', '3PT': '3/10', REB: 22, TOV: 8 });
  assert.equal(nbaTeamStats([], { homeId: 2, awayId: 1 }), null);
});

test('the full box: who played, by minutes, MIN PTS REB AST FG 3PT FT +/-', () => {
  const [away, home] = nbaBoxTables(BOX, game);
  assert.equal(away.abbr, 'BOS');
  const tb = away.tables[0];
  assert.deepEqual(tb.headings, ['MIN', 'PTS', 'REB', 'AST', 'FG', '3PT', 'FT', '+/-']);
  assert.deepEqual(tb.rows.map((r) => r.name), ['Jayson Tatum', 'Derrick White', 'Kristaps Porzingis'], 'DNP left off');
  assert.deepEqual(tb.rows[0].cells, ['42:00', 38, 11, 4, '13/24', '5/11', '7/8', '+6']);
  assert.equal(home.tables[0].rows[0].cells.at(-1), '-4');
  assert.equal(minutesOf(1754), '29:14');
  assert.equal(minutesOf(null), '');
});

test('the plays list: latest first, no substitutions, the running score on scoring plays only (away-home)', () => {
  const rows = nbaPlayRows([
    { playNumber: 1, period: 4, clock: '3:02', playType: 'Free Throw - 1 of 2', text: 'Brown makes free throw 1 of 2', homeScore: 99, awayScore: 101, scoring: true, offenseTeamId: 1 },
    { playNumber: 3, period: 4, clock: '2:14', playType: 'Jump Shot', text: 'Tatum makes 26-foot three point jumper', homeScore: 101, awayScore: 104, scoring: true, offenseTeamId: 1 },
    { playNumber: 2, period: 4, clock: '2:38', playType: 'Substitution', text: 'X enters the game for Y', homeScore: 101, awayScore: 101, scoring: false, offenseTeamId: 2 },
    { playNumber: 4, period: 5, clock: '4:40', playType: 'Shooting Foul', text: 'Duren shooting foul', homeScore: 101, awayScore: 104, scoring: false, offenseTeamId: 2 },
  ], { abbrOf: (id) => ({ 1: 'BOS', 2: 'DET' })[id] });
  assert.deepEqual(rows, [
    { when: 'OT 4:40', abbr: 'DET', text: 'Duren shooting foul', score: null },
    { when: 'Q4 2:14', abbr: 'BOS', text: 'Tatum makes 26-foot three point jumper', score: '104-101' },
    { when: 'Q4 3:02', abbr: 'BOS', text: 'Brown makes free throw 1 of 2', score: '101-99' },
  ]);
  assert.equal(nbaWhen(6, '1:02'), '2OT 1:02');
});

test('modules per state; NO win probability module for basketball, ever', () => {
  assert.deepEqual(nbaModules({ state: 'pre', hasMarket: false, hasYours: true }), ['card', 'yours']);
  assert.deepEqual(nbaModules({ state: 'live', hasYours: false }), ['card', 'chips']);
  assert.deepEqual(nbaModules({ state: 'live', hasYours: true }), ['card', 'yours', 'chips']);
  assert.deepEqual(nbaModules({ state: 'final', hasYours: true, hasLeaders: true, hasTeamStats: true, hasBox: true }), ['card', 'yours', 'leaders', 'teamstats', 'fullbox']);
  assert.deepEqual(nbaModules({ state: 'final', hasLeaders: true, hasTeamStats: true, hasBox: true, boxOpen: true }), ['card', 'leaders', 'teamstats', 'box']);
  for (const state of ['pre', 'live', 'final']) assert.ok(!nbaModules({ state, hasMarket: true, hasYours: true, hasLeaders: true, hasTeamStats: true, hasBox: true }).includes('winprob'));
  assert.deepEqual(nbaChips({ plays: 9, box: true, leaders: true, market: true }).map((c) => c.label), ['Plays', 'Box', 'Leaders', 'Market']);
  assert.deepEqual(nbaChips({ plays: 0, box: false, leaders: true, market: false }).map((c) => c.key), ['stats']);
});

test('the plays writer\'s shape: order is the identity, the team resolves by abbreviation, whitespace folds', () => {
  const p = shapeNbaPlays([
    { order: 518, type: 'Bad Pass\nTurnover', text: 'Draymond Green bad pass\nturnover (Kevin Durant steals)', period: 5, clock: '0.1', home_score: 113, away_score: 115, scoring_play: false, team: { abbreviation: 'GSW' } },
    { order: 519, type: 'End Period', text: 'End of the 1st  Overtime', period: 5, clock: '0.0', home_score: 113, away_score: 115, scoring_play: false, team: null },
    { type: 'no order', text: 'dropped' },
  ], new Map([['GSW', 10]]));
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], { providerPlayId: '518', playNumber: 518, period: 5, clock: '0.1', playType: 'Bad Pass Turnover', text: 'Draymond Green bad pass turnover (Kevin Durant steals)', homeScore: 113, awayScore: 115, scoring: false, offenseTeamId: 10 });
  assert.equal(p[1].offenseTeamId, null);
});

test('REPLAY: the synthesised bonus matches every recorded final; timeouts five of six', () => {
  let exact = 0;
  for (const id of Object.values(REPLAY_GAMES)) {
    const fx = loadReplay(id); const g = fx.game;
    const s = situationAt(fx.plays, fx.plays.length - 1, { home: g.home_team.abbreviation, away: g.visitor_team.abbreviation });
    assert.deepEqual(s.bonus, { home: g.home_in_bonus, away: g.visitor_in_bonus }, `${id} bonus`);
    exact += Number(s.timeouts.home === g.home_timeouts_remaining) + Number(s.timeouts.away === g.visitor_timeouts_remaining);
  }
  assert.equal(exact, 5);
});

test('REPLAY: a live row carries timeouts and bonus; the box before the end is points from the plays, after it the record', () => {
  const fx = loadReplay(REPLAY_GAMES.ot);
  const { endAt } = replaySpan(fx);
  const t = Date.parse('2026-03-06T02:48:50Z'); // Q4 2:38, GSW 95-93, GSW in the bonus
  const r = rowAt(fx, t);
  assert.equal(r.status_state, 'in_progress');
  assert.equal(r.visitor_in_bonus, true);
  assert.equal(r.home_in_bonus, false);
  assert.ok(Number.isInteger(r.home_timeouts_remaining));
  const live = statsAt(fx, t);
  const total = live.reduce((a, s) => a + s.pts, 0);
  assert.ok(total > 150 && total < 95 + 93 + 1, `points so far ${total}`);
  assert.equal(statsAt(fx, endAt + 1000), fx.stats, 'after the end: the recorded box, exactly');
});

test('IN YOUR GAMES (NBA): your pick and its state; settled "Lost · 2 of 3 tonight"; no Tonight\'s Six row', () => {
  const contest = { id: 9, board: [{ match_id: 7 }, { match_id: 8 }, { match_id: 9 }] };
  const entry = { lineup: { 7: 'home', 8: 'away', 9: 'home' } };
  const live = nbaYourGames({ game, contest, entry, boardMatches: new Map([[7, { status: 'live' }]]), signedIn: true });
  assert.deepEqual(live.rows, [{ kind: 'pickem', label: "PICK'EM", line: 'You have DET', value: 'trailing by 3', href: '/pickem/nba' }]);
  assert.deepEqual(live.open, []);
  const fin = { ...game, status: 'final' };
  const bm = new Map([
    [7, { status: 'final', home_score: 101, away_score: 104 }],
    [8, { status: 'final', home_score: 90, away_score: 99 }],
    [9, { status: 'final', home_score: 120, away_score: 100 }],
  ]);
  const settled = nbaYourGames({ game: fin, contest, entry, boardMatches: bm, signedIn: true });
  assert.equal(settled.rows[0].line, 'You had DET');
  assert.equal(settled.rows[0].value, 'Lost · 2 of 3 tonight');
  assert.ok(!settled.rows.some((r) => /six/i.test(r.label)), "Tonight's Six is absent, never a placeholder");
  assert.deepEqual(nbaYourGames({ game, contest: null, entry, signedIn: true }), { rows: [], open: [] });
  assert.deepEqual(nbaYourGames({ game: { ...game, id: 99 }, contest, entry, signedIn: true }), { rows: [], open: [] }, 'not on the board');
  assert.equal(marginWords('away', 101, 104), 'leading by 3');
  assert.equal(marginWords('home', 100, 100), 'tied');
});

test('IN YOUR GAMES (NBA): the offer reads the CURRENT tip; signed out it is the offer alone', () => {
  const now = new Date('2026-10-20T20:00:00Z');
  const pre = { ...game, status: 'scheduled', homeScore: null, awayScore: null, kickoffAt: '2026-10-20T23:30:00Z' };
  const contest = { id: 9, board: [{ match_id: 7, kickoff_at: '2026-10-20T19:00:00Z' }] };
  const open = nbaYourGames({ game: pre, contest, entry: null, boardMatches: new Map([[7, { status: 'scheduled', kickoff_at: '2026-10-20T23:30:00Z' }]]), signedIn: false, now });
  assert.deepEqual(open, { rows: [], open: [{ kind: 'pickem', label: "Pick'em", href: '/pickem/nba' }] }, 'the frozen 19:00Z tip has passed; the current one has not');
  const moved = nbaYourGames({ game: pre, contest, entry: null, boardMatches: new Map([[7, { status: 'scheduled', kickoff_at: '2026-10-20T19:30:00Z' }]]), signedIn: true, now });
  assert.deepEqual(moved.open, [], 'the current tip has passed');
  const picked = nbaYourGames({ game: pre, contest, entry: { lineup: { 7: 'away' } }, boardMatches: new Map([[7, { status: 'scheduled', kickoff_at: '2026-10-20T23:30:00Z' }]]), signedIn: true, now });
  assert.deepEqual(picked.rows[0].value, 'Locks at tip');
  assert.deepEqual(picked.open, []);
});

test('THE STRIP\'S WORDS: "1 of 3 picked" + next lock; signed out "3 to pick"; all tipped; settled; no games, no strip', () => {
  assert.deepEqual(nbaStripWords({ games: 3, pickable: 3, pickedOpen: 1, nextLock: 'T', signedIn: true }), { line: '1 of 3 picked', nextLock: 'T', cta: 'Pick' });
  assert.deepEqual(nbaStripWords({ games: 3, pickable: 3, nextLock: 'T', signedIn: false }), { line: '3 to pick', nextLock: 'T', cta: 'Pick' });
  assert.deepEqual(nbaStripWords({ games: 3, pickable: 0, picked: 2, signedIn: true }), { line: '3 games · all tipped · 2 picked', nextLock: null, cta: 'Board' });
  assert.deepEqual(nbaStripWords({ games: 3, settled: true, score: 2, max: 3, signedIn: true }), { line: 'Settled · 2 of 3 right', nextLock: null, cta: 'Board' });
  assert.equal(nbaStripWords({ games: 0 }), null);
});
