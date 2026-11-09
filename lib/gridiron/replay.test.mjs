// lib/gridiron/replay.test.mjs - the drive card replayed (drive-3). Pure: the
// truncation, the rebuilt drive summary, the clock the flash is judged on, and
// that the card it returns is driveCardFor's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replayFor, replayOrder, resolveCut, drivesAsOf, gameAsOf, REPLAY_AFTER_MS } from './replay.js';
import { driveCardFor } from './driveCard.js';

const HOME = { id: 1, abbreviation: 'NO', name: 'New Orleans Saints', short_name: 'Saints', colors: { primary: '#D3BC8D' } };
const AWAY = { id: 2, abbreviation: 'CLE', name: 'Cleveland Browns', short_name: 'Browns', colors: { primary: '#FF3C00' } };
const nflGame = { slug: 'x', leagueSlug: 'nfl', status: 'final', home: HOME, away: AWAY, homeScore: 10, awayScore: 0 };
const T0 = Date.parse('2026-11-08T18:00:00Z');
let seq = 0;
// One play. createdAt is when the poller stored it - 10 s apart, as live.
const P = (o) => ({ providerPlayId: `p${++seq}`, driveId: 'd1', driveNumber: 1, period: 1, clock: '10:00', down: 1, distance: 10, yardsToGoal: 70, yardsGained: 0,
  offenseTeamId: 1, playType: 'rush', text: 'x', scoring: false, homeScore: 0, awayScore: 0, createdAt: new Date(T0 + seq * 10_000).toISOString(), ...o });

// HOME (id 1) drive from its own 30 (ytg 70): +5, +20, +6, then a 39-yard TD; then AWAY kicks a FG.
const make = () => {
  seq = 0;
  return [
    P({ clock: '14:50', down: 1, distance: 10, yardsToGoal: 70, yardsGained: 5 }),                          // p1 -> 2nd & 5 at 65
    P({ clock: '14:20', down: 2, distance: 5, yardsToGoal: 65, yardsGained: 20, playType: 'pass-reception' }),  // p2 -> 1st & 10 at 45
    P({ clock: '13:50', down: 1, distance: 10, yardsToGoal: 45, yardsGained: 6 }),                          // p3 -> 2nd & 4 at 39
    P({ clock: '13:20', down: 2, distance: 4, yardsToGoal: 39, yardsGained: 39, playType: 'passing-touchdown', scoring: true, homeScore: 7, awayScore: 0 }), // p4 TD
    P({ clock: '13:20', down: null, distance: null, yardsToGoal: null, playType: 'extra-point-good', scoring: true, homeScore: 7, awayScore: 0 }),             // p5 PAT
    P({ driveId: 'd2', driveNumber: 2, offenseTeamId: 2, clock: '9:00', down: 3, distance: 6, yardsToGoal: 20, yardsGained: 2, homeScore: 7 }),                // p6
    P({ driveId: 'd2', driveNumber: 2, offenseTeamId: 2, clock: '8:20', down: 4, distance: 4, yardsToGoal: 18, yardsGained: 36, playType: 'field-goal-good', scoring: true, homeScore: 7, awayScore: 3 }), // p7 FG
    P({ driveId: null, driveNumber: null, offenseTeamId: null, clock: '8:20', down: null, distance: null, yardsToGoal: null, playType: 'official-timeout', homeScore: 7, awayScore: 3 }), // p8
  ];
};
const ENV = [
  { driveId: 'd1', driveNumber: 1, offenseTeamId: 1, offenseName: 'NO', playCount: 5, yards: 70, duration: null, startPeriod: 1, startClock: '14:50', startYardsToGoal: 70, endPeriod: 1, endClock: '13:20', result: 'Touchdown' },
  { driveId: 'd2', driveNumber: 2, offenseTeamId: 2, offenseName: 'CLE', playCount: 2, yards: 18, duration: null, startPeriod: 1, startClock: '9:05', startYardsToGoal: 20, result: 'Field goal' },
];
const at = (plays, i) => new Date(Date.parse(plays[i].createdAt) + REPLAY_AFTER_MS);

test('truncation: the score, the clock and the down come from the chosen play, later plays do not exist', () => {
  const plays = make();
  const r = replayFor({ game: nflGame, plays, drives: ENV, play: plays[1].providerPlayId });   // after p2
  assert.equal(r.plays.length, 2);
  assert.deepEqual([r.g.homeScore, r.g.awayScore], [0, 0], 'the final 10-0 is not the score at the cut');
  assert.equal(r.g.status, 'live');
  assert.deepEqual(r.g.liveState, { period: 1, clock: '14:20' });
  assert.equal(r.driveCard.mode, 'live');
  assert.equal(r.driveCard.line.startsWith('1st & 10'), true, `gain 20 on 2nd & 5 -> 1st & 10: ${r.driveCard.line}`);
  // ball at 45 to go, HOME attacks right: 26 + (100 - 45) * 3.02
  assert.equal(r.driveCard.ballX, 192.1);
  assert.equal(r.driveCard.firstDownX, 26 + (100 - 35) * 3.02);
  assert.equal(r.driveCard.redZone, null);
});

test('the current drive is REBUILT as of the play, never the final envelope', () => {
  const plays = make();
  const r = replayFor({ game: nflGame, plays, drives: ENV, play: plays[1].providerPlayId });
  assert.equal(r.drives.length, 1, 'drive 2 had not begun');
  assert.equal(r.drives[0].playCount, undefined, 'no stored count');
  assert.equal(r.drives[0].yards, undefined, 'no stored yards');
  assert.equal(r.drives[0].startYardsToGoal, 70, 'identity and start survive');
  // 2 plays, 70 -> 45 = 25 yds, 14:50 -> 14:20 = 0:30 of game clock
  assert.equal(r.driveCard.driveLine, '2 plays · 25 yds · 0:30');
  const r3 = replayFor({ game: nflGame, plays, drives: ENV, play: plays[2].providerPlayId });
  assert.equal(r3.driveCard.driveLine, '3 plays · 31 yds · 1:00', '3 snaps: 70 -> 39, 14:50 -> 13:50');
});

test('a TD flashes at +1 s: the scored-in end zone, the label, the scorer\'s whole drive', () => {
  const plays = make();
  const r = replayFor({ game: nflGame, plays, drives: ENV, play: plays[3].providerPlayId });
  assert.equal(r.now.getTime() - Date.parse(plays[3].createdAt), 1000);
  assert.equal(r.driveCard.mode, 'flash');
  assert.equal(r.driveCard.kind, 'TD');
  assert.equal(r.driveCard.endZones.right.flash, 'TD', 'HOME attacks right');
  assert.equal(r.driveCard.endZones.left.flash, null);
  assert.deepEqual([r.g.homeScore, r.g.awayScore], [7, 0]);
  assert.equal(r.driveCard.line, 'Touchdown · Saints');
  assert.equal(r.driveCard.driveLine, '4 plays · 70 yds · 1:30', '70 yards: its start to the goal line');
  assert.equal(r.driveCard.losX, 328);
});

test('the flash is the live card\'s own clock (35 s), judged on the instant when one is given', () => {
  const plays = make();
  const t = Date.parse(plays[3].createdAt);
  const soon = replayFor({ game: nflGame, plays, drives: ENV, at: new Date(t + 5_000).toISOString() });
  assert.equal(soon.cut.index, 3, 'the cut is the last play stored by then');
  assert.equal(soon.driveCard.mode, 'flash');
  // the game as stored through p6 (20 s after the TD): +25 s is inside the window, +36 s is not
  const upTo6 = plays.slice(0, 6);
  const inside = replayFor({ game: nflGame, plays: upTo6, drives: ENV, at: new Date(t + 25_000).toISOString() });
  assert.equal(inside.cut.index, 5);
  assert.equal(inside.driveCard.mode, 'flash');
  const outside = replayFor({ game: nflGame, plays: upTo6, drives: ENV, at: new Date(t + 36_000).toISOString() });
  assert.equal(outside.driveCard.mode, 'live', 'the 35 s window has closed');
  assert.equal(outside.driveCard.line.includes('Touchdown'), false);
});

test('a FG says FG, in the kicker\'s attacked end zone, with the yards to the kick\'s line', () => {
  const plays = make();
  const r = replayFor({ game: nflGame, plays, drives: ENV, play: plays[6].providerPlayId });
  assert.equal(r.driveCard.kind, 'FG');
  assert.equal(r.driveCard.endZones.left.flash, 'FG', 'AWAY attacks left');
  assert.deepEqual([r.g.homeScore, r.g.awayScore], [7, 3]);
  // started at 20 to go, kicked from the 18: 2 yards, not 20 + 18 (yards_gained is the kick)
  assert.equal(r.driveCard.driveLine.startsWith('2 plays · 2 yds'), true, r.driveCard.driveLine);
});

test('replay calls the live path: the card is driveCardFor\'s, byte for byte', () => {
  const plays = make();
  const r = replayFor({ game: nflGame, plays, drives: ENV, play: plays[1].providerPlayId });
  const direct = driveCardFor({ plays: r.plays, game: r.g, drives: r.drives, now: r.now });
  assert.deepEqual(r.driveCard, direct);
  assert.deepEqual(r.x.driveCard, direct);
});

test('CFB: no time of possession is derived from drive-granular clocks; a finished scoring drive keeps CFBD\'s', () => {
  seq = 0;
  const cfb = { ...nflGame, leagueSlug: 'cfb' };
  // every play of a CFB drive carries the drive's clock
  const plays = [
    P({ clock: '7:13', yardsToGoal: 93, yardsGained: 12 }),
    P({ clock: '7:13', yardsToGoal: 81, yardsGained: 5 }),
    P({ clock: '7:13', yardsToGoal: 76, yardsGained: 76, playType: 'Passing Touchdown', scoring: true, homeScore: 7 }),
    P({ clock: '3:25', down: 1, distance: 10, yardsToGoal: 87, offenseTeamId: 2, playType: 'Timeout', scoring: true, homeScore: 7 }),
  ];
  const env = [{ driveId: 'd1', driveNumber: 1, offenseTeamId: 1, playCount: 3, yards: 80, duration: '3:48', startPeriod: 1, startClock: '7:13', startYardsToGoal: 93, endClock: '3:25' }];
  const mid = replayFor({ game: cfb, plays, drives: env, play: plays[1].providerPlayId });
  assert.equal(mid.driveCard.driveLine, '2 plays · 17 yds', 'no 0:00 invented');
  const td = replayFor({ game: cfb, plays, drives: env, play: plays[2].providerPlayId });
  assert.equal(td.driveCard.mode, 'flash');
  assert.equal(td.driveCard.driveLine, '3 plays · 93 yds · 3:48', 'CFBD\'s duration; yards = start to the goal line, not CFBD\'s 80');
});

test('resolveCut: unknown play and a too-early instant name nothing; no cut means the last play', () => {
  const plays = replayOrder(make());
  assert.equal(resolveCut(plays, { play: 'nope' }), null);
  assert.equal(resolveCut(plays, { at: '2020-01-01T00:00:00Z' }), null);
  assert.equal(resolveCut(plays, { at: 'garbage' }), null);
  assert.equal(resolveCut([], {}), null);
  assert.equal(resolveCut(plays, {}).index, plays.length - 1);
  assert.equal(replayFor({ game: nflGame, plays: make(), drives: ENV, play: 'nope' }), null);
});

test('drivesAsOf keeps earlier drives whole and drops drives that had not begun', () => {
  const plays = make();
  const d = drivesAsOf(ENV, plays.slice(0, 6), plays);   // cut in drive 2
  assert.equal(d.length, 2);
  assert.equal(d[0].playCount, 5, 'drive 1 is over, its envelope stands');
  assert.equal(d[1].playCount, undefined, 'drive 2 is in progress');
  assert.deepEqual(drivesAsOf(ENV, [], []), []);
});

test('gameAsOf: live, the last score change, the last play\'s period and clock', () => {
  const plays = make();
  const g = gameAsOf(nflGame, plays.slice(0, 7));
  assert.deepEqual([g.status, g.homeScore, g.awayScore], ['live', 7, 3]);
  assert.deepEqual(g.liveState, { period: 1, clock: '8:20' });
});

// ---- the route: admin-gated by the proxy, nothing written -------------------
const src = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PAGE = code(src('app/admin/replay/[slug]/page.js'));
const LIB = code(src('lib/gridiron/replay.js'));

test('the route lives under /admin/ (proxy.js\'s Basic Auth scope) and is noindex', () => {
  const proxy = src('proxy.js');
  assert.match(proxy, /pathname\.startsWith\('\/admin\/'\)/);
  assert.match(proxy, /checkAdminBasic\(request\.headers\.get\('authorization'\)/);
  assert.match(PAGE, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
});

test('no writes: no SQL of its own, no server action, no INSERT/UPDATE/DELETE, no cache or error writes', () => {
  for (const [name, text] of [['page', PAGE], ['lib', LIB]]) {
    assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE)\b/i, `${name}: no write verbs`);
    assert.doesNotMatch(text, /use server|revalidatePath|revalidateTag|cookies\(|app_errors|last_seen|logError/, `${name}: no actions, no stamps`);
    assert.doesNotMatch(text, /from '@\/lib\/db'|from '\.\.\/db\.js'|sql`/, `${name}: no SQL here - reads go through getGamePage and gamecastFor`);
  }
  assert.match(PAGE, /getGamePage\(slug\)/);
  assert.match(PAGE, /gamecastFor\(game\.id\)/);
});

test('the page mounts the SAME CardFace the board and the game page mount', () => {
  assert.match(PAGE, /import \{ CardFace \} from '@\/components\/scores\/ScoreboardV4'/);
  assert.match(PAGE, /<CardFace g=\{r\.g\} x=\{r\.x\}/);
  assert.match(LIB, /driveCardFor\(\{ plays: truncated, game: g, drives: drivesNow, now: cut\.now \}\)/);
});
