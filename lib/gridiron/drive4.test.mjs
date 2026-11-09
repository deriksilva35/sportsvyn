// lib/gridiron/drive4.test.mjs - drive-4: the field-goal drive's yards, the recompute, the CFB per-play
// clock, the NFL last-play clean-up. PURE; no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconstructDrives, driveYardsFor } from './plays.js';
import { recomputeEnvelopes } from './recomputeDrives.js';
import { estimateCfbClocks } from './cfbClock.js';
import { nflPlayText, footballPlayText } from './playText.js';
import { replayFor } from './replay.js';
import { driveCardFor } from './driveCard.js';

// ---------------------------------------------------------------- 1. FG drive yards

const NO = { id: 7, abbreviation: 'NO' };
const row = (id, type, start, end, o = {}) => ({
  id, type_slug: type, team: NO, start_yards_to_endzone: start, end_yards_to_endzone: end,
  period: 3, clock_display: '8:00', start_down: 1, scoring_play: false, ...o,
});

test('a made field goal ends the drive at the KICK LINE, not at the goal line or BDL\'s end spot (CLE@NO r12: 63 -> 54)', () => {
  // start 63, gains to the 9, kicks 27 yards from there. BDL files the kick's end spot as 0 here.
  for (const endSpot of [0, null, 63, 81]) {
    const [d] = reconstructDrives([
      row(1, 'rush', 63, 50),
      row(2, 'pass-reception', 50, 20, { start_down: 2 }),
      row(3, 'rush', 20, 9, { start_down: 1 }),
      row(4, 'field-goal-good', 9, endSpot, { start_down: 4, scoring_play: true }),
      row(5, 'kickoff', 65, 75, { team: { id: 8, abbreviation: 'CLE' } }),
    ]);
    assert.equal(d.result, 'Field goal');
    assert.equal(d.startYardsToGoal, 63);
    assert.equal(d.yards, 54, `end spot ${endSpot}`);
    assert.equal(d.playCount, 4);
  }
});

test('driveYardsFor: touchdown covers the start, a normal end spot subtracts, an unknown end is null', () => {
  assert.equal(driveYardsFor(75, { type_slug: 'rush-touchdown', end_yards_to_endzone: null, start_yards_to_endzone: 3 }), 75);
  assert.equal(driveYardsFor(75, { type_slug: 'rush', end_yards_to_endzone: 40, start_yards_to_endzone: 50 }), 35);
  assert.equal(driveYardsFor(75, { type_slug: 'rush', end_yards_to_endzone: null, start_yards_to_endzone: 50 }), null);
  assert.equal(driveYardsFor(null, { type_slug: 'field-goal-good', start_yards_to_endzone: 9 }), null);
  assert.equal(driveYardsFor(20, { type_slug: 'field-goal-good', start_yards_to_endzone: 23 }), -3, 'a drive pushed back by sacks is negative, as the plays say');
});

test('recomputeEnvelopes: only Field-goal envelopes\' yards change, from the kick row; idempotent', () => {
  const envs = [
    { driveId: 'r1', result: 'Touchdown', yards: 75, startYardsToGoal: 75, playCount: 6 },
    { driveId: 'r2', result: 'Field goal', yards: 3, startYardsToGoal: 63, playCount: 11, startClock: '12:28' },
    { driveId: 'r3', result: 'Punt', yards: 12, startYardsToGoal: 70 },
  ];
  const plays = [
    { drive_id: 'r2', play_type: 'field-goal-good', play_number: 10, yards_to_goal: 12 },
    { drive_id: 'r1', play_type: 'rush-touchdown', play_number: 6, yards_to_goal: 4 },
  ];
  const a = recomputeEnvelopes(envs, plays);
  assert.deepEqual(a.changes, [{ driveId: 'r2', old: 3, new: 51 }]);
  assert.equal(a.drives[1].yards, 51);
  assert.equal(a.drives[1].playCount, 11, 'nothing else on the envelope moves');
  assert.equal(a.drives[0], envs[0]); assert.equal(a.drives[2], envs[2]);
  assert.equal(envs[1].yards, 3, 'the input is not mutated');
  assert.deepEqual(recomputeEnvelopes(a.drives, plays).changes, [], 'a second pass finds nothing');
  assert.deepEqual(recomputeEnvelopes(null, null), { drives: [], changes: [] });
});

// ---------------------------------------------------------------- 2. CFB clock per play

const C = (n, clock, o = {}) => ({ providerPlayId: `c${n}`, driveId: 'd1', playNumber: n, period: 1, clock, down: 1, yardsToGoal: 60, playType: 'Rush', ...o });

test('CFB: every mid-drive play of a drive carries the drive\'s clock; the replay spreads it between the drive\'s start and end', () => {
  // The feed (ORE@OSU): 15:00 on every play of the drive, the last play carries the clock the drive ended on.
  const out = estimateCfbClocks([C(1, '15:00'), C(2, '15:00'), C(3, '15:00'), C(4, '15:00'), C(5, '9:00')]);
  assert.deepEqual(out.map((p) => p.clock), ['15:00', '13:30', '12:00', '10:30', '9:00']);
  assert.deepEqual(out.map((p) => Boolean(p.clockEst)), [false, true, true, true, false], 'only the spread plays are marked');
  assert.equal(out[1].clockStored, '15:00', 'the stored clock is kept beside it');
  assert.deepEqual(estimateCfbClocks(out).map((p) => p.clock), out.map((p) => p.clock), 'idempotent');
});

test('CFB clock: a scoring sentence states its own clock, which is exact and anchors the spread (ORE@OSU TD at 3:25, drive closed by a timeout row)', () => {
  const run = [C(1, '7:13'), C(2, '7:13'), C(3, '7:13'), C(4, '7:13', { text: 'pass complete ... TOUCHDOWN, clock 03:25, 1ST DOWN' }), C(5, '3:25', { playType: 'Timeout' })];
  const out = estimateCfbClocks(run);
  assert.deepEqual(out.map((p) => p.clock), ['7:13', '5:57', '4:41', '3:25', '3:25']);
  assert.deepEqual(out.map((p) => Boolean(p.clockEst)), [false, true, true, false, false], 'the stated clock is not an estimate');
  assert.equal(out[3].clockStored, '7:13');
  assert.deepEqual(estimateCfbClocks(out).map((p) => p.clock), out.map((p) => p.clock), 'idempotent');
});

test('CFB clock: a "(MM:SS)" prefix is the play\'s exact clock; no estimate, no "~" on those plays', () => {
  const T = (n, pre) => C(n, '8:16', { text: `${pre} Shotgun #23 A.Newberry rush middle for 3 yards` });
  const out = estimateCfbClocks([T(1, '(08:21)'), T(2, '(07:58)'), T(3, '(7:30)'), T(4, '(:45)'), T(5, '(00:12)')]);
  assert.deepEqual(out.map((p) => p.clock), ['8:21', '7:58', '7:30', '0:45', '0:12']);
  assert.deepEqual(out.map((p) => Boolean(p.clockEst)), [false, false, false, false, false]);
  // mixed: prefixed anchors at 1, 4; plays 2, 3 without are estimated between them
  const mixed = estimateCfbClocks([T(1, '(09:00)'), C(2, '9:00', { text: 'x' }), C(3, '9:00', { text: 'x' }), T(4, '(06:00)')]);
  assert.deepEqual(mixed.map((p) => p.clock), ['9:00', '8:00', '7:00', '6:00']);
  assert.deepEqual(mixed.map((p) => Boolean(p.clockEst)), [false, true, true, false]);
  assert.deepEqual(estimateCfbClocks(mixed).map((p) => p.clock), mixed.map((p) => p.clock), 'idempotent');
});

test('CFB clock: runs are per drive AND per period; short runs and a flat clock are left alone; order and input kept', () => {
  const plays = [
    C(1, '1:20'), C(2, '1:20'), C(3, '0:00', { playType: 'End Period' }),
    C(4, '15:00', { period: 2 }), C(5, '15:00', { period: 2 }), C(6, '12:00', { period: 2 }),
    C(1, '5:00', { driveId: 'd2' }), C(2, '5:00', { driveId: 'd2' }),
  ];
  const out = estimateCfbClocks(plays);
  assert.equal(out.length, plays.length);
  assert.deepEqual(out.map((p) => p.providerPlayId), plays.map((p) => p.providerPlayId));
  assert.equal(out[1].clock, '0:40', 'Q1: 1:20 -> 0:00, middle play');
  assert.equal(out[4].clock, '13:30', 'Q2 starts again at 15:00');
  assert.equal(out[7].clock, '5:00', 'a two-play drive has nothing between');
  assert.equal(plays[1].clock, '1:20', 'input not mutated');
  const flat = estimateCfbClocks([C(1, '8:00'), C(2, '8:00'), C(3, '8:00')]);
  assert.deepEqual(flat.map((p) => p.clock), ['8:00', '8:00', '8:00']);
});

test('replay (CFB): the card shows the clock of THAT play, not the drive\'s (was "Q1 15:00" mid-drive)', () => {
  const home = { id: 1, abbreviation: 'OSU', name: 'Ohio State', short_name: 'Buckeyes', colors: { primary: '#BB0000' } };
  const away = { id: 2, abbreviation: 'ORE', name: 'Oregon', short_name: 'Ducks', colors: { primary: '#154733' } };
  const game = { slug: 'x', leagueSlug: 'cfb', status: 'final', home, away, homeScore: 7, awayScore: 0 };
  const T0 = Date.parse('2026-11-07T20:00:00Z');
  const mk = (n, clock, o = {}) => ({ providerPlayId: `r${n}`, driveId: 'd1', driveNumber: 1, playNumber: n, period: 1, clock, down: 1 + (n % 3), distance: 8,
    yardsToGoal: 70 - n * 6, yardsGained: 6, offenseTeamId: 1, playType: 'Rush', text: 'Shotgun #13 L.Fahey rush', scoring: false, homeScore: 0, awayScore: 0,
    createdAt: new Date(T0 + n * 10_000).toISOString(), ...o });
  const plays = [mk(1, '15:00'), mk(2, '15:00'), mk(3, '15:00'), mk(4, '15:00'), mk(5, '9:00', { yardsToGoal: 40 })];
  const mid = replayFor({ game, plays, drives: [], play: 'r3' });
  assert.deepEqual(mid.g.liveState, { period: 1, clock: '12:00' });
  assert.equal(replayFor({ game, plays, drives: [], play: 'r1' }).g.liveState.clock, '15:00');
  assert.equal(replayFor({ game, plays, drives: [], play: 'r5' }).g.liveState.clock, '9:00', 'the drive\'s last play keeps its own clock');
  assert.equal(replayFor({ game: { ...game, leagueSlug: 'nfl' }, plays, drives: [], play: 'r3' }).g.liveState.clock, '15:00', 'NFL clocks are real and untouched');
  assert.equal(mid.x.lastPlay, 'L.Fahey rush', 'and the sentence is cleaned');
});

test('the LIVE card reads no play clock: the drive card is a function of down, spot and drive, never plays.clock', () => {
  const home = { id: 1, abbreviation: 'OSU', colors: { primary: '#BB0000' } };
  const away = { id: 2, abbreviation: 'ORE', colors: { primary: '#154733' } };
  const p = (clock) => [{ period: 1, clock, down: 2, distance: 8, yardsToGoal: 40, yardsGained: 2, offenseTeamId: 1, playType: 'Rush', text: 'x', driveId: 'd', createdAt: '2026-11-07T20:00:00Z' }];
  const a = driveCardFor({ plays: p('15:00'), game: { home, away, leagueSlug: 'cfb' }, drives: [] });
  const b = driveCardFor({ plays: p('3:12'), game: { home, away, leagueSlug: 'cfb' }, drives: [] });
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------- 3. NFL last-play text

test('NFL: formation prefixes and a leading clock go; the sentence is otherwise verbatim', () => {
  const cases = [
    ['(Shotgun) P.Mahomes pass short left to X.Worthy to KC 46 for 2 yards (E.Jones).', 'P.Mahomes pass short left to X.Worthy to KC 46 for 2 yards (E.Jones).'],
    ['(No Huddle, Shotgun) C.Ward pass short right to C.Tate to NYG 8 for 13 yards (J.Holland; G.Newsome).', 'C.Ward pass short right to C.Tate to NYG 8 for 13 yards (J.Holland; G.Newsome).'],
    ['(No Huddle) D.Pierce left guard to DAL 21 for 3 yards (D.Overshown).', 'D.Pierce left guard to DAL 21 for 3 yards (D.Overshown).'],
    ['(Punt formation) PENALTY on NO, Delay of Game, 5 yards, enforced at LV 43 - No Play.', 'PENALTY on NO, Delay of Game, 5 yards, enforced at LV 43 - No Play.'],
    ['(Run formation) PENALTY on NYG, Delay of Game, 5 yards, enforced at TEN 41 - No Play.', 'PENALTY on NYG, Delay of Game, 5 yards, enforced at TEN 41 - No Play.'],
    ['(Field Goal formation) PENALTY on NYG, False Start, 5 yards.', 'PENALTY on NYG, False Start, 5 yards.'],
    ['(2:46) (Shotgun) P.Mahomes pass short right to K.Walker ran ob at SEA 15 for 15 yards (N.Emmanwori).', 'P.Mahomes pass short right to K.Walker ran ob at SEA 15 for 15 yards (N.Emmanwori).'],
    ['(:10) J.Stout punts 64 yards to TEN 21, Center-B.Mann.', 'J.Stout punts 64 yards to TEN 21, Center-B.Mann.'],
    ['(12:32) (Shotgun) G.Smith sacked at DET 20 for -5 yards (sack split by A.Hutchinson and S.Gill-Howard).', 'G.Smith sacked at DET 20 for -5 yards (sack split by A.Hutchinson and S.Gill-Howard).'],
    [' (Shotgun) T.Lawrence pass short middle to B.Strange to JAX 34 for 23 yards (R.Yeast).', 'T.Lawrence pass short middle to B.Strange to JAX 34 for 23 yards (R.Yeast).'],
  ];
  for (const [raw, want] of cases) assert.equal(nflPlayText(raw), want, raw);
});

test('NFL: jersey-looking text is NOT touched (a timeout count is not a jersey number)', () => {
  assert.equal(nflPlayText('Timeout #1 by KC at 06:53.'), 'Timeout #1 by KC at 06:53.');
  assert.equal(nflPlayText('Official Timeout at 06:12.'), 'Official Timeout at 06:12.');
});

test('NFL: the six non-standard club codes are normalised, in the places a code appears', () => {
  const cases = [
    ['(Shotgun) T.Shough pass deep left to C.Olave to BLT 46 for 20 yards (M.Humphrey).PENALTY on NO-C.Olave, Unsportsmanlike Conduct, 15 yards, enforced at BLT 46.',
      'T.Shough pass deep left to C.Olave to BAL 46 for 20 yards (M.Humphrey).PENALTY on NO-C.Olave, Unsportsmanlike Conduct, 15 yards, enforced at BAL 46.'],
    ['K.Hunt up the middle to CLV 21 for 1 yard (J.Doe).PENALTY on CLV-M.Garrett, Offside, 5 yards.', 'K.Hunt up the middle to CLE 21 for 1 yard (J.Doe).PENALTY on CLE-M.Garrett, Offside, 5 yards.'],
    ['C.Ryland kicks 66 yards from ARZ 35 to LAC -1. K.Mitchell to LAC 23 for 24 yards (S.Fehoko; K.Crawford).', 'C.Ryland kicks 66 yards from ARI 35 to LAC -1. K.Mitchell to LAC 23 for 24 yards (S.Fehoko; K.Crawford).'],
    ['(Shotgun) J.Taylor left tackle to HST 49 for 4 yards (K.Lassiter; J.Hansen).', 'J.Taylor left tackle to HOU 49 for 4 yards (K.Lassiter; J.Hansen).'],
    ['H.Mevis kicks 59 yards from LA 35 to PHI 6. W.Shipley to PHI 33 for 27 yards (S.Dolac; Q.Lake).', 'H.Mevis kicks 59 yards from LAR 35 to PHI 6. W.Shipley to PHI 33 for 27 yards (S.Dolac; Q.Lake).'],
    ['PENALTY on WAS-B.Wright, Offensive Holding, 10 yards, enforced at WAS 27.', 'PENALTY on WSH-B.Wright, Offensive Holding, 10 yards, enforced at WSH 27.'],
    ['PENALTY on LA, Delay of Game, 5 yards, enforced at LA 30 - No Play.', 'PENALTY on LAR, Delay of Game, 5 yards, enforced at LAR 30 - No Play.'],
  ];
  for (const [raw, want] of cases) assert.equal(nflPlayText(raw), want, raw);
});

test('NFL: standard codes, names and words that merely contain a code are left alone', () => {
  for (const s of ['J.Love pass incomplete short left to M.Golden.', 'B.Irving up the middle to TB 20 for 12 yards (P.Umanmielen).',
    'Penalty on LAC-J.Doe, Holding, declined.', 'A.Kamara up the middle to LV 29 for 1 yard (T.Johnson).', 'LAVEL Jones was WASHED out at HOME.',
    'D.Wallace to WASH 4.']) assert.equal(nflPlayText(s), s, s);
});

test('nflPlayText is idempotent and null-safe; footballPlayText routes by league', () => {
  const raw = '(No Huddle, Shotgun) T.Shough pass deep left to C.Olave to BLT 46 for 20 yards.';
  assert.equal(nflPlayText(nflPlayText(raw)), nflPlayText(raw));
  assert.equal(nflPlayText(null), null); assert.equal(nflPlayText(''), '');
  assert.equal(footballPlayText('nfl', raw), nflPlayText(raw));
  assert.equal(footballPlayText('cfb', '(04:51) Shotgun #24 B.Mac rush for 3 yards'), 'B.Mac rush for 3 yards');
  assert.equal(footballPlayText('mlb', raw), raw, 'other sports are untouched');
});
