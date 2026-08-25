// lib/gridiron/driveStrip.test.mjs - the field, the drives, the two provider
// traps, and what this build is and is not allowed to claim.
//
// The geometry tests are pinned to THE MOCK'S OWN NUMBERS. The mock hard-codes
// every yard line at a literal percentage; if our arithmetic drifts, the strip
// stops agreeing with the drawing that specified it, and these tests are the
// only place that would notice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pctForAbsolute, absoluteYardFromLeft, stripGeometry, downDistanceLabel,
  spotLabel, gamecastState, buildDriveChart, driveSubLine, simulateAsOf,
  lastLivePlay, ENDZONE_PCT, FIELD_UNITS,
} from './driveStrip.js';
import {
  reconstructDrives, bdlDriveResult, cfbdDriveResult, normalizeCfbdLive,
  normalizeBdlPlays, DRIVE_RESULTS, HANDOFF_TYPES, ADMIN_TYPES,
} from './plays.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} vs ${b}`);

// ------------------------------------------------------- geometry vs the mock

test('the field reproduces the mock\'s own yard-line offsets exactly', () => {
  // Every one of these is read off drivestrip-gamecast-mock-v0_2.html.
  near(pctForAbsolute(10), 16.67, 'own 10');
  near(pctForAbsolute(20), 25.00, 'own 20');
  near(pctForAbsolute(50), 50.00, 'midfield');
  near(pctForAbsolute(80), 75.00, 'their 20');
  near(pctForAbsolute(90), 83.33, 'their 10');
  near(ENDZONE_PCT, 8.333, 'end zone width');
  assert.equal(FIELD_UNITS, 120);
});

test('the mock\'s ball and to-go markers land where the mock draws them', () => {
  // Frame 1: PHI (home) has 2nd & 7 at DAL 34. Mock: ball 63.33%, to-go 69.17%.
  const g = stripGeometry({
    offenseIsHome: true, yardsToGoal: 34, distance: 7, driveStartYardsToGoal: 75,
  });
  near(g.ball, 63.33, 'ball');
  near(g.toGo, 69.17, 'to-go');
});

test('the two codes point opposite ways from the same yards_to_goal', () => {
  // THE WHOLE POINT of storing yards_to_goal rather than a yard line. Home and
  // away at 34 yards from their target are on OPPOSITE halves of the field.
  assert.equal(absoluteYardFromLeft(true, 34), 66);
  assert.equal(absoluteYardFromLeft(false, 34), 34);
  near(pctForAbsolute(absoluteYardFromLeft(false, 34)), 36.67, 'away ball');
});

test('goal-to-go draws no to-go line - the goal line already is one', () => {
  const g = stripGeometry({ offenseIsHome: true, yardsToGoal: 3, distance: 10 });
  assert.equal(g.toGo, null);
  assert.equal(downDistanceLabel(1, 10, 3), '1st & G');
  assert.equal(downDistanceLabel(2, 7, 34), '2nd & 7');
  assert.equal(downDistanceLabel(null, 10, 20), null, 'no down means no label, not "null & 10"');
});

test('the spot names whose half of the field the ball is on', () => {
  assert.equal(spotLabel(34, 'PHI', 'DAL'), 'DAL 34');
  assert.equal(spotLabel(75, 'PHI', 'DAL'), 'PHI 25');
  assert.equal(spotLabel(50, 'PHI', 'DAL'), '50');
  assert.equal(spotLabel(null, 'PHI', 'DAL'), null);
});

test('a ball outside the field of play is clamped, never drawn off the strip', () => {
  near(pctForAbsolute(-5), pctForAbsolute(0), 'behind the goal line');
  near(pctForAbsolute(140), pctForAbsolute(100), 'past the far goal line');
});

// ------------------------------------------------------------- the states

test('the strip states follow status and the plays count, nothing else', () => {
  assert.equal(gamecastState({ status: 'scheduled' }).mode, 'none');
  assert.equal(gamecastState({ status: 'final', playCount: 0 }).mode, 'none');
  assert.equal(gamecastState({ status: 'final', playCount: 140 }).mode, 'final');
  // THE HONEST GAP: live with no plays says so rather than drawing an empty field.
  assert.equal(gamecastState({ status: 'live', playCount: 0 }).mode, 'pending');
  assert.equal(
    gamecastState({ status: 'live', playCount: 9, lastPlay: { down: 2, yardsToGoal: 34 } }).mode,
    'live',
  );
  // No down and no spot is between-drives, not a stale ball left on the field.
  assert.equal(
    gamecastState({ status: 'live', playCount: 9, lastPlay: { down: null, yardsToGoal: null } }).mode,
    'between',
  );
  assert.equal(
    gamecastState({ status: 'live', playCount: 9, liveState: { clock: 'HALF' },
      lastPlay: { down: 1, yardsToGoal: 40 } }).mode,
    'halftime',
  );
});

// -------------------------------------------------- TRAP 2: BDL drive grouping

// A miniature of the real defect: PHI drives, punts (BDL tags the punt DAL,
// because DAL receives), then DAL drives.
const BDL_FIXTURE = [
  { id: 1, type_slug: 'kickoff', team: { id: 21, abbreviation: 'PHI' }, period: 1, clock_display: '15:00', start_yards_to_endzone: 65 },
  { id: 2, type_slug: 'rush', team: { id: 21, abbreviation: 'PHI' }, period: 1, clock_display: '14:54', start_down: 1, start_distance: 10, start_yards_to_endzone: 70, end_yards_to_endzone: 63 },
  { id: 3, type_slug: 'pass-incompletion', team: { id: 21, abbreviation: 'PHI' }, period: 1, clock_display: '14:10', start_down: 2, start_distance: 3, start_yards_to_endzone: 63, end_yards_to_endzone: 63 },
  { id: 4, type_slug: 'pass-reception', team: { id: 21, abbreviation: 'PHI' }, period: 1, clock_display: '13:30', start_down: 3, start_distance: 3, start_yards_to_endzone: 63, end_yards_to_endzone: 61 },
  // The punt. BDL says DAL - the RECEIVING side. It is PHI's punt.
  { id: 5, type_slug: 'punt', team: { id: 6, abbreviation: 'DAL' }, period: 1, clock_display: '12:50', start_yards_to_endzone: 61 },
  { id: 6, type_slug: 'rush', team: { id: 6, abbreviation: 'DAL' }, period: 1, clock_display: '12:40', start_down: 1, start_distance: 10, start_yards_to_endzone: 80, end_yards_to_endzone: 76 },
  { id: 7, type_slug: 'rushing-touchdown', team: { id: 6, abbreviation: 'DAL' }, period: 1, clock_display: '11:00', start_down: 1, start_distance: 4, start_yards_to_endzone: 4, scoring_play: true },
  { id: 8, type_slug: 'kickoff', team: { id: 21, abbreviation: 'PHI' }, period: 1, clock_display: '11:00', start_yards_to_endzone: 65 },
];

test('a punt belongs to the team that PUNTED, not the team BDL tags it with', () => {
  const drives = reconstructDrives(BDL_FIXTURE);
  assert.equal(drives.length, 2, 'two drives, not three');
  assert.equal(drives[0].offenseAbbr, 'PHI');
  assert.equal(drives[1].offenseAbbr, 'DAL');
  // The punt terminates PHI's drive rather than opening DAL's.
  assert.deepEqual(drives[0].plays.map((p) => p.id), [2, 3, 4, 5]);
  assert.deepEqual(drives[1].plays.map((p) => p.id), [6, 7, 8]);
});

test('taking BDL\'s team at face value is the bug this rule exists to stop', () => {
  // The naive rule, written out, to show it produces a different - wrong - split.
  const naive = [];
  let cur = null;
  for (const p of BDL_FIXTURE) {
    if (ADMIN_TYPES.has(p.type_slug)) continue;
    const t = p.team.abbreviation;
    if (!cur || cur.team !== t) { cur = { team: t, plays: [] }; naive.push(cur); }
    cur.plays.push(p);
  }
  assert.equal(naive.length, 3, 'the naive rule splits PHI\'s punt into its own drive');
  assert.notEqual(naive.length, reconstructDrives(BDL_FIXTURE).length);
});

test('the scrimmage count excludes the terminal handoff play', () => {
  const [phi, dal] = reconstructDrives(BDL_FIXTURE);
  assert.equal(phi.playCount, 3, 'three snaps, the punt is not one of them');
  assert.equal(dal.playCount, 2);
});

test('a drive ending in a score is a touchdown, not an unmappable kickoff', () => {
  // The bug the unmapped counter caught: the last ROW of a scoring drive is the
  // ensuing kickoff. Reading it alone reported "(drive) kickoff" on 46 drives.
  const [, dal] = reconstructDrives(BDL_FIXTURE);
  assert.equal(dal.plays.at(-1).type_slug, 'kickoff', 'precondition: terminal row IS a kickoff');
  assert.equal(dal.result, DRIVE_RESULTS.TD);
});

test('an unrecognised drive shape is NAMED and returns null, never guessed', () => {
  const run = { unmapped: {} };
  const res = bdlDriveResult([{ type_slug: 'brand-new-play-type', start_down: 2 }], run);
  assert.equal(res, null, 'null, so the chart renders no tag rather than a wrong one');
  assert.ok(Object.keys(run.unmapped).some((k) => k.includes('brand-new-play-type')));
});

test('CFBD drive words map, and a new word is named rather than invented', () => {
  assert.equal(cfbdDriveResult('TD'), DRIVE_RESULTS.TD);
  assert.equal(cfbdDriveResult('Touchdown'), DRIVE_RESULTS.TD);
  assert.equal(cfbdDriveResult('Punt'), DRIVE_RESULTS.PUNT);
  // All three of these were real gaps the first backfill's counter reported.
  assert.equal(cfbdDriveResult('Missed FG'), DRIVE_RESULTS.MISSED_FG);
  assert.equal(cfbdDriveResult('Interception Touchdown'), DRIVE_RESULTS.TURNOVER);
  assert.equal(cfbdDriveResult('End Of Quarter'), DRIVE_RESULTS.END_QUARTER);
  const run = { unmapped: {} };
  assert.equal(cfbdDriveResult('Sousaphone Recovery', run), null);
  assert.ok(Object.keys(run.unmapped).some((k) => k.includes('Sousaphone')));
});

// --------------------------------------------- TRAP 1 + CFBD native grouping

const CFBD_FIXTURE = {
  status: 'Final',
  drives: [
    {
      id: '4017625212', offenseId: 2426, offense: 'Navy', playCount: 2, yards: 75,
      duration: '7:44', startPeriod: 1, startClock: '15:00', startYardsToGoal: 75,
      endPeriod: 1, endClock: '7:16', result: 'Touchdown',
      plays: [
        { id: '1', homeScore: 0, awayScore: 0, period: 1, clock: '14:54', teamId: 2426, down: 1, distance: 10, yardsToGoal: 75, yardsGained: 7, playType: 'Rush', playText: 'rush middle for 7' },
        { id: '2', homeScore: 7, awayScore: 0, period: 1, clock: '7:16', teamId: 2426, down: 3, distance: 2, yardsToGoal: 5, yardsGained: 5, playType: 'Rushing Touchdown', playText: 'rush middle, TOUCHDOWN' },
      ],
    },
  ],
};

test('CFBD keeps its native drive id - nothing is reconstructed for CFB', () => {
  const rows = normalizeCfbdLive(CFBD_FIXTURE, new Map([['2426', 900]]));
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.driveId === '4017625212'), 'the provider\'s own id, verbatim');
  assert.ok(!rows.some((r) => String(r.driveId).startsWith('r')), 'no synthesised id on the CFB path');
  assert.equal(rows[0].offenseTeamId, 900);
});

test('CFBD carries no scoring flag, so scoring is derived from the scoreboard moving', () => {
  const rows = normalizeCfbdLive(CFBD_FIXTURE, new Map([['2426', 900]]));
  assert.equal(rows[0].scoring, false);
  assert.equal(rows[1].scoring, true, '0-0 to 7-0 is a score, and the only evidence of one');
});

test('a touchdown\'s yards gained is the distance left, not zero', () => {
  // BDL nulls end_yards_to_endzone on a TD. Number(null) is 0, and a 4-yard
  // scoring run reported as +0 is the VAL column's bug in a new costume.
  const rows = normalizeBdlPlays(
    [{ id: 9, type_slug: 'rushing-touchdown', team: { id: 6 }, period: 4, clock_display: '2:00',
       start_down: 1, start_distance: 4, start_yards_to_endzone: 4, end_yards_to_endzone: null,
       scoring_play: true }],
    new Map([['6', 700]]),
  );
  assert.equal(rows[0].yardsGained, 4);
});

// ------------------------------------------------------------- the chart

test('the drive chart runs newest first and keeps the provider\'s own summary', () => {
  const plays = [
    { driveId: 'a', driveNumber: 1, playNumber: 1, offenseTeamId: 900, yardsToGoal: 75, providerPlayId: '1' },
    { driveId: 'b', driveNumber: 2, playNumber: 1, offenseTeamId: 700, yardsToGoal: 80, providerPlayId: '2' },
  ];
  const rows = buildDriveChart(plays, {
    drives: [{ driveId: 'a', driveNumber: 1, offenseTeamId: 900, playCount: 13, yards: 75, duration: '7:44', result: 'Touchdown', startYardsToGoal: 75 }],
    homeTeamId: 900,
    teamAbbr: new Map([[900, 'NAVY'], [700, 'ARMY']]),
  });
  assert.equal(rows[0].driveNumber, 2, 'newest drive leads');
  const navy = rows.find((r) => r.driveId === 'a');
  assert.equal(navy.playCount, 13, 'the envelope\'s count wins over the stored play count');
  assert.equal(navy.offenseIsHome, true);
  assert.equal(navy.derived, false);
  // A drive with no envelope is FLAGGED derived rather than quietly presented
  // as the provider's own numbers.
  assert.equal(rows.find((r) => r.driveId === 'b').derived, true);
  assert.equal(driveSubLine(navy, 'ARMY'), '13 plays · 75 yds · 7:44 · started NAVY 25');
});

// --------------------------------------------- simulation honesty

test('simulateAsOf truncates and says so; unsimulated is not marked', () => {
  const plays = Array.from({ length: 70 }, (_, i) => ({ providerPlayId: String(i) }));
  const s = simulateAsOf(plays, 40);
  assert.equal(s.plays.length, 40);
  assert.equal(s.simulated, true);
  assert.equal(s.ofTotal, 70);
  assert.equal(simulateAsOf(plays, null).simulated, false);
  assert.equal(simulateAsOf(plays, 999).plays.length, 70, 'clamped, never past the end');
  assert.equal(simulateAsOf(plays, 0).plays.length, 1, 'at least one play');
});

test('the last live play skips administrative rows with no ball on the field', () => {
  const plays = [
    { down: 1, yardsToGoal: 40, text: 'a' },
    { down: null, yardsToGoal: null, text: 'Official Timeout' },
  ];
  assert.equal(lastLivePlay(plays).text, 'a');
  assert.equal(lastLivePlay([{ down: null, yardsToGoal: null }]), null);
});

test('a simulated strip is LABELLED simulated in the render', () => {
  // The relay's honesty requirement, pinned in the markup rather than a comment.
  const comp = src('components/gridiron/Gamecast.js');
  assert.match(comp, /simulated && <span className="ds-sim">simulated<\/span>/);
});

test('no win probability is rendered - neither provider gives us one', () => {
  const comp = src('components/gridiron/Gamecast.js');
  const code = comp.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /wpbar|win-prob|winProbability/i);
});

test('the component computes no field positions of its own', () => {
  // ONE SOURCE for geometry. A hand-written percentage in the markup would be a
  // second place where a yard line lives.
  const comp = src('components/gridiron/Gamecast.js');
  const marks = comp.slice(comp.indexOf('function Field'), comp.indexOf('export function DriveStrip'));
  assert.doesNotMatch(marks, /left:\s*['"`]\d+\.\d+%/, 'no literal percentage offsets');
  assert.match(comp, /pctForAbsolute/);
});

// --------------------------------------------- migration + importer shape

test('migration 074 is idempotent and keyed for re-import', () => {
  const m = src('migrations/074_plays.sql');
  assert.match(m, /CREATE TABLE IF NOT EXISTS plays/);
  assert.match(m, /UNIQUE \(match_id, provider_play_id\)/);
  assert.match(m, /CREATE INDEX IF NOT EXISTS plays_match_order_idx/);
  assert.match(m, /CREATE INDEX IF NOT EXISTS plays_match_drive_idx/);
  // The table must not store a derived absolute yard line - see TRAP 1.
  assert.doesNotMatch(m, /absolute_yard|yard_line_absolute/);
  assert.match(m, /yards_to_goal\s+INTEGER/);
});

test('the importer re-import path updates rather than inserts', () => {
  const imp = src('lib/gridiron/playsImport.js');
  assert.match(imp, /ON CONFLICT \(match_id, provider_play_id\) DO UPDATE SET/);
});

test('no poller ships in this relay', () => {
  // The relay's own boundary, pinned so a later edit cannot quietly cross it.
  // Comments stripped first: the file's own header explains that the poller
  // relay is "only a scheduler", and a raw grep reads that promise-of-absence
  // as the thing itself - the same prose trap the admin console hit.
  const imp = src('lib/gridiron/playsImport.js')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(imp, /setInterval|cron|schedule/i);
  let cronRoutes = [];
  try {
    cronRoutes = readFileSync(path.join(REPO, 'vercel.json'), 'utf8').match(/plays/g) ?? [];
  } catch { /* no vercel.json is fine */ }
  assert.equal(cronRoutes.length, 0, 'no plays cron is registered yet');
});

test('the handoff and admin vocabularies do not overlap', () => {
  for (const t of HANDOFF_TYPES) {
    assert.ok(!ADMIN_TYPES.has(t), `${t} cannot be both a handoff and administrative`);
  }
});

test('a drive still in progress is never tagged with how it ended', () => {
  // The leak this caught: simulating play 40 of a completed game showed the
  // live drive tagged "Touchdown" - the stored envelope knows the ending
  // because the game is over in the table, but the strip is claiming to show
  // the state as of play 40, where that touchdown has not happened.
  const plays = [{ driveId: 'a', driveNumber: 1, playNumber: 1, offenseTeamId: 900, providerPlayId: '1' }];
  const opts = {
    drives: [{ driveId: 'a', driveNumber: 1, offenseTeamId: 900, result: 'Touchdown' }],
    homeTeamId: 900, teamAbbr: new Map([[900, 'PHI']]),
  };
  assert.equal(buildDriveChart(plays, opts)[0].result, 'Touchdown', 'a settled drive keeps its result');
  assert.equal(
    buildDriveChart(plays, { ...opts, inProgressDriveId: 'a' })[0].result,
    'In progress',
  );
});
