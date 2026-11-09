// lib/gridiron/driveCard.test.mjs - the live drive card's pure module (drive-2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELD, xAt, firstDownLine, redZone, isGoalToGo, downLabel, classifyScore, latestScore, scoringMoment,
  driveTotals, driveLine, gameElapsed, mmss, driveCardFor, FLASH_MS, inkOn,
} from './driveCard.js';

const NOW = new Date('2026-11-08T21:00:00Z');
const ago = (s) => new Date(NOW.getTime() - s * 1000).toISOString();
const HOME = { id: 1, abbreviation: 'ARI', name: 'Arizona', colors: { primary: '#97233F' } };
const AWAY = { id: 2, abbreviation: 'SEA', name: 'Seattle', colors: { primary: '#002244' } };
const game = { home: HOME, away: AWAY };
let n = 0;
const play = (o) => ({ period: 4, clock: `${12 - (n++ % 11)}:00`, down: 2, distance: 8, yardsToGoal: 42, yardsGained: 2, offenseTeamId: 2, playType: 'rush', text: 'x', scoring: false, driveId: 'r9', homeScore: 0, awayScore: 0, createdAt: ago(300), ...o });

test('geometry is the mock\'s: 354 wide, 26 end zones, 3.02 per yard', () => {
  assert.equal(FIELD.width, 354); assert.equal(FIELD.zone, 26);
  assert.equal(xAt(0), 26); assert.equal(xAt(100), 328);
  assert.equal(xAt(42), 152.84, 'ARI 42 is the mock\'s ball x');
  assert.equal(xAt(34), 128.68, 'and its first-down line');
});

test('first-down line: LOS + distance, both directions, clamped, hidden on & Goal', () => {
  // SEA (away) attacks LEFT: ball ARI 42 (ytg 42), 8 to go -> ytg 34 -> x 128.68
  assert.deepEqual(firstDownLine({ offenseIsHome: false, yardsToGoal: 42, distance: 8 }), { ytg: 34, x: 128.68 });
  // ARI (home) attacks RIGHT: ball at its own 30 (ytg 70), 10 to go -> 60 to go -> 40 yards from left
  assert.deepEqual(firstDownLine({ offenseIsHome: true, yardsToGoal: 70, distance: 10 }), { ytg: 60, x: xAt(40) });
  // 9 yards out, 8 to go: one yard short of the goal line, not past it
  assert.equal(firstDownLine({ offenseIsHome: true, yardsToGoal: 9, distance: 8 }).ytg, 1);
  // & Goal: distance >= yards to goal -> no line
  assert.equal(firstDownLine({ offenseIsHome: true, yardsToGoal: 6, distance: 6 }), null);
  assert.equal(firstDownLine({ offenseIsHome: false, yardsToGoal: 6, distance: 9 }), null);
  assert.equal(isGoalToGo(6, 6), true); assert.equal(isGoalToGo(7, 6), false);
  assert.equal(firstDownLine({ offenseIsHome: true, yardsToGoal: null, distance: 3 }), null);
});

test('down labels: "2nd & 8", "1st & Goal"', () => {
  assert.equal(downLabel(2, 8, 42), '2nd & 8');
  assert.equal(downLabel(1, 6, 6), '1st & Goal');
  assert.equal(downLabel(1, 3, 3), '1st & Goal');
  assert.equal(downLabel(5, 3, 40), null);
});

test('red zone: the attacked end, only with the ball inside the 20', () => {
  assert.equal(redZone({ offenseIsHome: true, yardsToGoal: 21 }), null);
  assert.equal(redZone({ offenseIsHome: false, yardsToGoal: 40 }), null);
  const right = redZone({ offenseIsHome: true, yardsToGoal: 6 });
  assert.equal(right.x, 267.6); assert.equal(right.x + right.w, 328, 'home attacks right: the last 20 yards');
  const left = redZone({ offenseIsHome: false, yardsToGoal: 20 });
  assert.equal(left.x, 26); assert.equal(left.w, 60.4, 'away attacks left: the first 20 yards');
});

test('card: mid-drive NFL, side/yard label, aria, band and lines', () => {
  const plays = [
    play({ down: 1, distance: 10, yardsToGoal: 79, yardsGained: 5, clock: '6:00' }),
    play({ down: 2, distance: 5, yardsToGoal: 74, yardsGained: 32, clock: '5:30' }),
    play({ down: 2, distance: 10, yardsToGoal: 44, yardsGained: 2, clock: '5:00' }),
  ];
  const drives = [{ driveId: 'r9', offenseTeamId: 2, playCount: 9, yards: 37, duration: null, startPeriod: 4, startClock: '9:30', startYardsToGoal: 79 }];
  const c = driveCardFor({ plays, game, drives, now: NOW });
  assert.equal(c.mode, 'live');
  assert.equal(c.line, '3rd & 8 · ARI 42', 'afterSnap: 2nd & 10 at 44, +2 = 3rd & 8 at 42');
  assert.equal(c.driveLine, '9 plays · 37 yds · 4:30', 'NFL time of possession is game-clock elapsed 9:30 -> 5:00');
  assert.equal(c.aria, 'Ball at ARI 42, first down at ARI 34');
  assert.equal(c.ballX, 152.84); assert.equal(c.firstDownX, 128.68); assert.equal(c.losX, 152.84);
  assert.equal(c.startX, xAt(79), 'SEA started at ARI 79 -> from-left 79');
  assert.deepEqual(c.band, { x: 152.84, w: r2(xAt(79) - 152.84) });
  assert.equal(c.redZone, null);
  assert.equal(c.endZones.left.abbr, 'ARI'); assert.equal(c.endZones.left.color, '#97233F'); assert.equal(c.endZones.right.flash, null);
});
const r2 = (v) => Math.round(v * 100) / 100;

test('card: 1st & Goal, red zone for the team with the ball, goal aria, no first-down line', () => {
  // ARI (home) with the ball, 6 from SEA's goal line after a 22-yard catch: snap 28 -> 6, gained 22 >= 10
  const plays = [play({ offenseTeamId: 1, down: 2, distance: 4, yardsToGoal: 28, yardsGained: 22, playType: 'pass-reception' })];
  const c = driveCardFor({ plays, game, drives: [{ driveId: 'r9', offenseTeamId: 1, playCount: 11, yards: 69, duration: '5:20', startYardsToGoal: 75 }], now: NOW });
  assert.equal(c.line, '1st & Goal · SEA 6');
  assert.equal(c.driveLine, '11 plays · 69 yds · 5:20', 'CFB-style stored duration is used as is');
  assert.equal(c.aria, 'Ball at SEA 6, goal to go');
  assert.equal(c.firstDownX, null);
  assert.equal(c.redZone.x, 267.6, 'the right end: the end ARI attacks');
  assert.equal(c.ballX, xAt(94));
});

test('card: midfield reads "50"; no pending snap shows just the ball', () => {
  const mid = driveCardFor({ plays: [play({ down: 1, distance: 10, yardsToGoal: 50, yardsGained: 0, playType: 'penalty' })], game, drives: [], now: NOW });
  // a penalty has no derivable state: the ball alone at the last snap's spot
  assert.equal(mid.line, '50');
  assert.equal(mid.aria, 'Ball at 50');
  assert.equal(mid.firstDownX, null); assert.equal(mid.ballX, xAt(50));
  const live = driveCardFor({ plays: [play({ down: 1, distance: 10, yardsToGoal: 60, yardsGained: 10 })], game, drives: [], now: NOW });
  assert.equal(live.line, '1st & 10 · 50', 'gained 10 from the 60 -> 1st & 10 at the 50');
});

test('card: nothing to draw is null (no snap, or no offense)', () => {
  assert.equal(driveCardFor({ plays: [], game, now: NOW }), null);
  assert.equal(driveCardFor({ plays: [play({ offenseTeamId: null })], game, now: NOW }), null);
});

test('drive totals: NFL across a quarter break (derived), CFB from the summary, plain derivation', () => {
  // started Q1 1:12 left, latest play Q2 13:50: 1:12 -> 0:00 of Q1 = 72 s, + 70 s into Q2 = 142 s = 2:22
  const nfl = driveTotals({ env: { playCount: 7, yards: 41, duration: null, startPeriod: 1, startClock: '1:12', endPeriod: 2, endClock: '13:50' } });
  assert.deepEqual([nfl.plays, nfl.yards, nfl.top], [7, 41, '2:22']);
  const cfb = driveTotals({ env: { playCount: 10, yards: 19, duration: '4:50', startPeriod: 4, startClock: '4:50' } });
  assert.deepEqual([cfb.plays, cfb.yards, cfb.top], [10, 19, '4:50']);
  // no envelope: from the drive's own plays
  const own = driveTotals({ plays: [
    play({ period: 2, clock: '10:00', yardsToGoal: 70, yardsGained: 5 }),
    play({ period: 2, clock: '9:20', yardsToGoal: 65, yardsGained: 15 }),
  ] });
  assert.deepEqual([own.plays, own.yards, own.top, own.derived], [2, 20, '0:40', true]);
  assert.equal(driveLine({ plays: 1, yards: 0, top: '0:00' }), '1 play · 0 yds · 0:00');
  assert.equal(driveLine({ plays: null }), null);
  assert.equal(gameElapsed(5, '9:00'), 3600 + 60); assert.equal(mmss(271), '4:31');
});

test('classification: TD / FG / SAFETY from the type and the points', () => {
  assert.equal(classifyScore('rushing-touchdown', 6), 'TD');
  assert.equal(classifyScore('Passing Touchdown', 7), 'TD');
  assert.equal(classifyScore('interception-return-touchdown', 6), 'TD');
  assert.equal(classifyScore('field-goal-good', 3), 'FG');
  assert.equal(classifyScore('Field Goal Good', 3), 'FG');
  assert.equal(classifyScore('safety', 2), 'SAFETY');
  assert.equal(classifyScore('Safety', 2), 'SAFETY');
  assert.equal(classifyScore('pass-reception', 6), 'TD', 'unknown type: the delta decides');
  assert.equal(classifyScore('x', 3), 'FG');
  assert.equal(classifyScore('extra-point-good', 1), null);
  assert.equal(classifyScore('two-point-conversion', 2), null, 'a two-point try is not a safety');
  assert.equal(classifyScore('pass-reception', 2), null);
  assert.equal(classifyScore('rush', 0), null);
});

const tdPlay = (o = {}) => play({ down: 1, distance: 6, yardsToGoal: 6, yardsGained: 6, playType: 'rushing-touchdown', scoring: true, homeScore: 0, awayScore: 6, clock: '3:00', ...o });

test('scoring moment: appears at 10 s, clears at 40 s, boundary at 35 s', () => {
  assert.ok(scoringMoment([tdPlay({ createdAt: ago(10) })], NOW));
  assert.ok(scoringMoment([tdPlay({ createdAt: ago(35) })], NOW), 'inside 35 s');
  assert.equal(scoringMoment([tdPlay({ createdAt: ago(36) })], NOW), null);
  assert.equal(scoringMoment([tdPlay({ createdAt: ago(40) })], NOW), null);
  assert.equal(FLASH_MS, 35_000);
  // an extra point after the TD does not replace it as "the latest score"
  const pat = play({ scoring: true, playType: 'extra-point-good', homeScore: 0, awayScore: 7, clock: '2:58', createdAt: ago(8), down: null, yardsToGoal: null });
  assert.equal(latestScore([tdPlay({ createdAt: ago(10) }), pat]).kind, 'TD');
  // a score buried under many later plays is never the flash
  const later = Array.from({ length: 9 }, (_, i) => play({ clock: `2:${String(50 - i).padStart(2, '0')}`, createdAt: ago(5) }));
  assert.equal(scoringMoment([tdPlay({ createdAt: ago(5) }), ...later], NOW), null);
});

test('scoring moment: the scored-in end zone goes volt with TD/FG/SAFETY; headline replaces the down line', () => {
  // SEA (away) scores: SEA attacks LEFT -> the LEFT zone flashes
  const td = driveCardFor({ plays: [tdPlay({ createdAt: ago(10) })], game, drives: [{ driveId: 'r9', offenseTeamId: 2, playCount: 12, yards: 75, duration: null, startPeriod: 4, startClock: '9:00', startYardsToGoal: 75 }], now: NOW });
  assert.equal(td.mode, 'flash'); assert.equal(td.kind, 'TD');
  assert.equal(td.line, 'Touchdown · Seattle');
  assert.equal(td.endZones.left.flash, 'TD'); assert.equal(td.endZones.right.flash, null);
  assert.equal(td.losX, xAt(0), 'the line of scrimmage is the goal line'); assert.equal(td.ballX, xAt(0) + 7, 'the ball rests just inside it, clear of the zone label'); assert.equal(td.firstDownX, null); assert.equal(td.redZone, null);
  assert.match(td.driveLine, /^12 plays · 75 yds · /);
  // ARI (home) kicks a field goal: RIGHT zone
  const fg = driveCardFor({ plays: [tdPlay({ offenseTeamId: 1, playType: 'field-goal-good', homeScore: 3, awayScore: 0, createdAt: ago(5) })], game, now: NOW });
  assert.equal(fg.kind, 'FG'); assert.equal(fg.endZones.right.flash, 'FG'); assert.equal(fg.line, 'Field goal · Arizona');
  // safety by the home defence against SEA: ARI scores 2
  const sf = driveCardFor({ plays: [tdPlay({ offenseTeamId: 2, playType: 'safety', homeScore: 2, awayScore: 0, createdAt: ago(5) })], game, now: NOW });
  assert.equal(sf.kind, 'SAFETY'); assert.equal(sf.line, 'Safety · Arizona');
  // 40 s later it is just the ball again
  const gone = driveCardFor({ plays: [tdPlay({ createdAt: ago(40) })], game, now: NOW });
  assert.equal(gone.mode, 'live'); assert.equal(gone.endZones.left.flash, null);
});

test('CFB scoring is inferred from the score change: the delta is against the previous SCORING row', () => {
  const rows = [
    play({ playType: 'Rush', scoring: false, homeScore: 0, awayScore: 0, clock: '10:00' }),
    play({ playType: 'Rushing Touchdown', scoring: true, homeScore: 7, awayScore: 0, offenseTeamId: 1, clock: '9:00', createdAt: ago(12) }),
    play({ playType: 'Kickoff', scoring: false, homeScore: 0, awayScore: 0, clock: '9:00', down: null, yardsToGoal: null }),  // stale 0-0 stoppage-style row
  ];
  const s = latestScore(rows);
  assert.equal(s.kind, 'TD'); assert.equal(s.side, 'home');
});

test('ink: white on dark zones, navy on light ones', () => {
  assert.equal(inkOn('#002244', 'W', 'N'), 'W'); assert.equal(inkOn('#FFB612', 'W', 'N'), 'N'); assert.equal(inkOn(null, 'W', 'N'), 'W');
});

// ---- found replaying NFL CLE@NO and CFB ORE@OSU, 7-8 Nov (drive-3) ----------

test('drive totals count snaps: timeouts, end-of-period rows, kickoffs and the other team\'s rows are not plays', () => {
  const mine = (o) => play({ offenseTeamId: 1, ...o });
  const plays = [
    mine({ playType: 'Kickoff', offenseTeamId: 2, yardsToGoal: 65, yardsGained: 0, clock: '15:00' }),   // the receiving team's kickoff row, in the drive
    mine({ playType: 'Rush', yardsToGoal: 75, yardsGained: 4, clock: '14:30' }),
    mine({ playType: 'Timeout', offenseTeamId: 2, yardsToGoal: 90, yardsGained: 0, clock: '14:00' }),   // the DEFENSE's timeout, at the defense's yard line
    mine({ playType: 'Pass Reception', yardsToGoal: 71, yardsGained: 18, clock: '13:40' }),
    mine({ playType: 'End Period', yardsToGoal: 53, yardsGained: 0, clock: '13:00' }),
  ];
  const t = driveTotals({ plays });
  assert.equal(t.plays, 2, 'two snaps');
  assert.equal(t.yards, 22, '75 -> 53, not 65 -> 90 (-25)');
});

test('drive totals: a field goal does not move the offense (its yards_gained is the kick)', () => {
  const t = driveTotals({ plays: [
    play({ offenseTeamId: 1, period: 3, clock: '8:56', yardsToGoal: 63, yardsGained: 5 }),
    play({ offenseTeamId: 1, period: 3, clock: '2:30', yardsToGoal: 9, yardsGained: 27, playType: 'field-goal-good', scoring: true }),
  ] });
  assert.equal(t.yards, 54, '63 -> 9, not 63 -> -18 = 81');
});

test('CFB never derives a time from its drive-granular play clocks; the stored duration still shows', () => {
  const cfbGame = { ...game, leagueSlug: 'cfb' };
  const plays = [1, 2, 3].map(() => play({ offenseTeamId: 2, period: 4, clock: '7:13', yardsToGoal: 60, yardsGained: 5, driveId: 'c1' }));
  const live = driveCardFor({ plays, game: cfbGame, drives: [], now: NOW });
  assert.equal(live.driveLine.includes(':'), false, `no invented 0:00: ${live.driveLine}`);
  const withEnv = driveCardFor({ plays, game: cfbGame, drives: [{ driveId: 'c1', playCount: 3, yards: 9, duration: '1:20', startYardsToGoal: 60 }], now: NOW });
  assert.equal(withEnv.driveLine, '3 plays · 9 yds · 1:20');
  // the NFL, with real clocks, still derives
  const nfl = driveCardFor({ plays: [play({ offenseTeamId: 2, period: 4, clock: '7:13', driveId: 'n1' }), play({ offenseTeamId: 2, period: 4, clock: '6:40', driveId: 'n1' })], game, drives: [], now: NOW });
  assert.equal(nfl.driveLine.endsWith('0:33'), true, nfl.driveLine);
});

test('a scoring drive\'s yards are its geometry: TD = start to the goal line, FG = start to the kick\'s line', () => {
  const stamp = ago(5);
  const td = driveCardFor({
    plays: [play({ offenseTeamId: 1, playType: 'Passing Touchdown', scoring: true, homeScore: 7, yardsToGoal: 13, yardsGained: 13, driveId: 'c1', createdAt: stamp, clock: '7:13' })],
    game, drives: [{ driveId: 'c1', offenseTeamId: 1, playCount: 10, yards: 80, duration: '3:48', startYardsToGoal: 93 }], now: NOW,
  });
  assert.equal(td.driveLine, '10 plays · 93 yds · 3:48', 'CFBD said 80 for a drive from the 7');
  const fg = driveCardFor({
    plays: [play({ offenseTeamId: 2, playType: 'Field Goal Good', scoring: true, awayScore: 3, yardsToGoal: 15, yardsGained: 33, driveId: 'c2', createdAt: stamp, clock: '11:26' })],
    game, drives: [{ driveId: 'c2', offenseTeamId: 2, playCount: 12, yards: 60, duration: '4:54', startYardsToGoal: 75 }], now: NOW,
  });
  assert.equal(fg.driveLine, '12 plays · 60 yds · 4:54');
  assert.equal(fg.kind, 'FG');
});
