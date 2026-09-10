// lib/gridiron/nflLive.test.mjs - the live NFL game page against the opening
// night fixture: BDL's game object and full plays list for NE at SEA
// (game 1392216, 9 Sep 2026), captured mid-4th quarter.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseBdlProse, shortOf, mapLiveStatus } from '../live/vocabulary.js';
import { lineScoreGrid, liveChip, periodOf } from './lineScore.js';
import { normalizeBdlPlays, reconstructDrives } from './plays.js';
import { buildDriveChart, gamecastState, lastLivePlay, lastActionPlay, byGameClock, downDistanceLabel, spotLabel } from './driveStrip.js';
import { scoringFromPlays } from './gameDetail.js';
import { install } from '../testing/nextResolve.mjs';

const GAME = JSON.parse(readFileSync(new URL('./fixtures/bdl-game-1392216.json', import.meta.url), 'utf8')).data;
const FINAL = JSON.parse(readFileSync(new URL('./fixtures/bdl-game-1392216-final.json', import.meta.url), 'utf8')).data;
const PLAYS = JSON.parse(readFileSync(new URL('./fixtures/bdl-plays-1392216.json', import.meta.url), 'utf8')).data;
const TEAMS = new Map([['1', 48066], ['31', 48084]]); // BDL NE -> ours, BDL SEA -> ours (PROD ids)

// Every distinct in-game string the nfl-games poller logged as unmapped on
// opening night, in the order they appeared, plus the shapes we expect later.
const TONIGHT = ['14:55 - 1st', '11:42 - 1st', '7:29 - 1st', '4:42 - 1st', '3:24 - 1st', '1:22 - 1st',
  '14:48 - 2nd', '11:08 - 2nd', '9:11 - 2nd', '6:45 - 2nd', '4:39 - 2nd', '2:00 - 2nd', '0:57 - 2nd', '0:38 - 2nd',
  'halftime', '14:18 - 3rd', '13:26 - 3rd', '11:53 - 3rd', '10:21 - 3rd', '9:29 - 3rd', '6:53 - 3rd', '6:12 - 3rd',
  '3:13 - 3rd', '1:26 - 3rd', '15:00 - 4th', '11:28 - 4th', '11:23 - 4th', '8:37 - 4th', '5:59 - 4th', '5:45 - 4th'];

test('the prose parser: every string from opening night parses, and each one reads back as its chip', () => {
  for (const s of TONIGHT) {
    const ls = parseBdlProse(s);
    assert.ok(ls, `${s} parses`);
    if (s === 'halftime') { assert.deepEqual(ls, { period: 2, clock: '0:00' }); assert.equal(liveChip(ls), 'HALF'); continue; }
    const [clock, q] = s.split(' - ');
    assert.deepEqual(ls, { period: Number(q[0]), clock });
    assert.equal(liveChip(ls), `Q${q[0]} · ${clock}`);
    assert.equal(periodOf(ls), Number(q[0]));
  }
  assert.deepEqual(parseBdlProse(GAME.status), { period: 4, clock: '4:40' }, 'the fixture object itself');
  assert.deepEqual(parseBdlProse('10:00 - OT'), { period: 5, clock: '10:00' }); assert.equal(shortOf(parseBdlProse('10:00 - OT')), 'OT');
  assert.deepEqual(parseBdlProse('End of 3rd'), { period: 3, clock: '0:00' }); assert.deepEqual(parseBdlProse('Half'), { period: 2, clock: '0:00' });
  for (const s of ['9/13 - 1:00 PM EDT', 'Final', 'Final/OT', '', null, 'Delayed', 'Postponed']) assert.equal(parseBdlProse(s), null, `${s} does not parse - and does not throw`);
});

test('status is the machine field: in_progress is live whatever the prose says, and the quarters ride every tick', () => {
  const unmapped = [];
  assert.equal(mapLiveStatus('bdl', GAME.status_state, unmapped), 'live'); assert.deepEqual(unmapped, []);
  assert.equal(mapLiveStatus('bdl', 'final', unmapped), 'final'); assert.equal(mapLiveStatus('bdl', 'scheduled', unmapped), 'scheduled');
  // the metadata syncNflGames writes for this object
  const game = {
    status: 'live', homeScore: GAME.home_team_score, awayScore: GAME.visitor_team_score,
    lineScores: {
      home: [GAME.home_team_q1, GAME.home_team_q2, GAME.home_team_q3, GAME.home_team_q4, GAME.home_team_ot],
      away: [GAME.visitor_team_q1, GAME.visitor_team_q2, GAME.visitor_team_q3, GAME.visitor_team_q4, GAME.visitor_team_ot],
    },
    liveState: parseBdlProse(GAME.status),
    home: { abbreviation: 'SEA' }, away: { abbreviation: 'NE' },
  };
  const grid = lineScoreGrid(game);
  assert.deepEqual(grid.columns, ['1', '2', '3', '4'], 'through the 4th, no OT column');
  assert.deepEqual(grid.rows.map((r) => [r.abbr, ...r.cells, r.total]), [
    ['NE', GAME.visitor_team_q1, GAME.visitor_team_q2, GAME.visitor_team_q3, GAME.visitor_team_q4, GAME.visitor_team_score],
    ['SEA', GAME.home_team_q1, GAME.home_team_q2, GAME.home_team_q3, GAME.home_team_q4, GAME.home_team_score],
  ]);
  assert.deepEqual(grid.rows.map((r) => [...r.cells, r.total]), [[0, 7, 3, 0, 10], [0, 0, 3, 10, 13]], 'the capture: SEA 13-10, 4:40 left');
  assert.equal(liveChip(game.liveState), 'Q4 · 4:40', 'the header chip');
  // a halftime tick: two columns, HALF chip
  const half = { ...game, liveState: parseBdlProse('halftime'), lineScores: { home: [0, 0, null, null, null], away: [0, 7, null, null, null] } };
  assert.deepEqual(lineScoreGrid(half).columns, ['1', '2']); assert.equal(liveChip(half.liveState), 'HALF');
  // an unparsed prose: quarters still render, chip withheld, all four columns
  const blind = { ...game, liveState: null };
  assert.deepEqual(lineScoreGrid(blind).columns, ['1', '2', '3', '4']); assert.equal(liveChip(null), null);
});

function normalized() {
  const plays = normalizeBdlPlays(PLAYS, TEAMS);
  const grouped = reconstructDrives(PLAYS);
  const drives = grouped.map((d, i) => ({
    driveId: d.driveId, driveNumber: i + 1, offenseTeamId: TEAMS.get(String(d.offenseBdlTeamId)) ?? null,
    offenseName: d.offenseAbbr, playCount: d.playCount, yards: d.yards, duration: null,
    startPeriod: d.startPeriod, startClock: d.startClock, startYardsToGoal: d.startYardsToGoal,
    endPeriod: d.endPeriod, endClock: d.endClock, result: d.result,
  }));
  return { plays, drives };
}

test('the strip state from the fixture plays: live, a ball on the field, a drive in progress', () => {
  const { plays, drives } = normalized();
  assert.equal(plays.length, PLAYS.length);
  const last = lastLivePlay(plays);
  assert.ok(last, 'a last play with a ball spot');
  assert.equal(last.period, 4); assert.equal(last.clock, '4:40');
  assert.match(last.text, /D\.Maye pass deep middle to M\.Hollins/);
  const state = gamecastState({ status: 'live', playCount: plays.length, lastPlay: last, liveState: parseBdlProse(GAME.status) });
  assert.equal(state.mode, 'live', JSON.stringify(state));
  const rows = buildDriveChart(plays, { drives, homeTeamId: 48084, teamAbbr: new Map([[48066, 'NE'], [48084, 'SEA']]) });
  assert.ok(rows.length >= 15, `${rows.length} drives`);
  const current = rows[0];
  assert.equal(current.offenseAbbr, 'NE', 'NE has the ball at the capture');
  assert.equal(downDistanceLabel(last.down, last.distance, last.yardsToGoal) != null, true);
  assert.equal(spotLabel(last.yardsToGoal, 'NE', 'SEA') != null, true);
});

test('the last-play line and the strip render from the fixture: down and distance, the spot, the text', async () => {
  install();
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { DriveStrip, LastPlay } = await import('../../components/gridiron/Gamecast.js');
  const { plays, drives } = normalized();
  const last = lastLivePlay(plays);
  const rows = buildDriveChart(plays, { drives, homeTeamId: 48084, teamAbbr: new Map([[48066, 'NE'], [48084, 'SEA']]) });
  const state = gamecastState({ status: 'live', playCount: plays.length, lastPlay: last, liveState: parseBdlProse(GAME.status) });
  const strip = renderToStaticMarkup(React.createElement(DriveStrip, { state, lastPlay: last, drive: rows[0], homeAbbr: 'SEA', awayAbbr: 'NE', offenseAbbr: 'NE', defenseAbbr: 'SEA', simulated: false }));
  assert.match(strip, /class="ds-dd">/, 'down and distance is the strip headline');
  assert.match(strip, /class="ds-ball"|ds-ball/, 'a ball marker');
  assert.match(strip, /ds-togo/, 'a to-go line');
  assert.match(strip, /NE ball/, 'possession');
  const lp = renderToStaticMarkup(React.createElement(LastPlay, { play: last }));
  assert.match(lp, /D\.Maye pass deep middle to M\.Hollins/);
});

test('the scoring summary reads scoring_play rows from plays: five scores, in quarter order, running score on each', () => {
  const { plays } = normalized();
  const quarters = scoringFromPlays(plays);
  const all = quarters.flatMap((q) => q.plays);
  assert.equal(all.length, PLAYS.filter((p) => p.scoring_play).length);
  assert.equal(all.length, 5);
  assert.deepEqual(quarters.map((q) => q.label), ['Q2', 'Q3', 'Q4']);
  assert.deepEqual(all.map((e) => e.scoring_type), ['TD', 'FG', 'FG', 'TD', 'FG']);
  assert.deepEqual(all.map((e) => `${e.quarter} ${e.clock}`), ['2 9:11', '3 11:49', '3 3:13', '4 11:28', '4 5:50']);
  for (const e of all) { assert.ok(['TD', 'FG', 'XP', '2PT', 'SAFETY', 'SCORE'].includes(e.scoring_type)); assert.ok(e.home_score != null && e.away_score != null, 'running score'); assert.ok(e.description); }
  assert.deepEqual([all.at(-1).away_score, all.at(-1).home_score], [GAME.visitor_team_score, GAME.home_team_score], 'the last score is the game object\'s score');
});

test('no win probability anywhere on a live football page: the market strip is pre-game only and BDL\'s per-play number is never stored', () => {
  const page = readFileSync(new URL('../../app/nfl/game/[slug]/page.js', import.meta.url), 'utf8');
  assert.match(page, /\{isPreGame\(game\.status\) && odds \? <OddsStrip/);
  assert.doesNotMatch(page, /win_probability|winProb|WinProbability/);
  const plays = readFileSync(new URL('./plays.js', import.meta.url), 'utf8');
  assert.doesNotMatch(plays, /home_win_probability/, 'the fixture rows carry home_win_probability; the normaliser leaves it on the floor');
  assert.ok(PLAYS.some((p) => p.home_win_probability != null), 'and the fixture does carry it, so the guard is real');
});

test('the final object: status final, no clock, the full line score, the strip in final mode', () => {
  assert.equal(mapLiveStatus('bdl', FINAL.status_state, []), 'final');
  assert.equal(parseBdlProse(FINAL.status), null, '"Final" is not a clock');
  const game = {
    status: 'final', homeScore: FINAL.home_team_score, awayScore: FINAL.visitor_team_score,
    lineScores: {
      home: [FINAL.home_team_q1, FINAL.home_team_q2, FINAL.home_team_q3, FINAL.home_team_q4, FINAL.home_team_ot],
      away: [FINAL.visitor_team_q1, FINAL.visitor_team_q2, FINAL.visitor_team_q3, FINAL.visitor_team_q4, FINAL.visitor_team_ot],
    },
    liveState: null, home: { abbreviation: 'SEA' }, away: { abbreviation: 'NE' },
  };
  const grid = lineScoreGrid(game);
  assert.deepEqual(grid.columns, ['1', '2', '3', '4']);
  assert.deepEqual(grid.rows.map((r) => [...r.cells, r.total]), [[0, 7, 3, 0, 10], [0, 0, 3, 10, 13]], 'SEA 13, NE 10, final');
  assert.equal(liveChip(null), null);
  const { plays } = normalized();
  assert.deepEqual(gamecastState({ status: 'final', playCount: plays.length, lastPlay: lastLivePlay(plays), liveState: null }), { mode: 'final' });
});

test('the last-play line reads the last PLAY, never a stoppage; the strip keeps the stoppage\'s situation', () => {
  const { plays } = normalized();
  const real = lastActionPlay(plays);
  assert.match(real.text, /D\.Maye pass deep middle to M\.Hollins/);
  const stopped = [...plays, { ...plays.at(-1), providerPlayId: 'x', playType: 'two-minute-warning', text: 'Two-Minute Warning', down: 4, distance: 1, yardsToGoal: 1 }];
  assert.equal(lastActionPlay(stopped).text, real.text, 'the text skips the warning');
  assert.equal(lastLivePlay(stopped).providerPlayId, real.providerPlayId, 'the strip skips it too - BDL files stoppages with a junk start spot (yards_to_endzone 0)');
  assert.equal(lastLivePlay(stopped).yardsToGoal, real.yardsToGoal);
  assert.equal(lastActionPlay([]), null); assert.equal(lastActionPlay(null), null);
});

test('the last play is found by the game clock, not by array order - playsFor puts kickoffs and stoppages last', () => {
  const { plays } = normalized();
  const real = lastActionPlay(plays);
  // the order playsFor() serves: drives first, drive-less rows (kickoffs,
  // warnings) after them - the opening kickoff becomes the array's last element
  const served = [...plays.filter((p) => p.driveNumber != null), ...plays.filter((p) => p.driveNumber == null)];
  assert.notEqual(served.at(-1).providerPlayId, real.providerPlayId, 'the scramble is real');
  assert.equal(lastActionPlay(served).providerPlayId, real.providerPlayId, 'still the Maye pass at 4:40');
  assert.equal(lastLivePlay(served).providerPlayId, lastLivePlay(plays).providerPlayId);
  const ordered = byGameClock(served);
  assert.equal(ordered[0].playType, 'kickoff'); assert.equal(ordered[0].period, 1); assert.equal(ordered[0].clock, '15:00');
  assert.equal(ordered.at(-1).clock, '4:40'); assert.equal(ordered.at(-1).period, 4);
  for (let i = 1; i < ordered.length; i++) assert.ok((ordered[i].period ?? 0) >= (ordered[i - 1].period ?? 0), 'periods never go backwards');
});
