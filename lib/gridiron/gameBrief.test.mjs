// lib/gridiron/gameBrief.test.mjs - the football envelope and its fallback.
//
// The generation half needs the model and the assembly half needs the database.
// What is testable without either is the part that got things WRONG on the
// first real run: the derived counts, and the deterministic text that publishes
// when the model fails twice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { countScoring, gridironFallback, reconcileScores } = await import('./gameBrief.js');

// The real Hall of Fame game, all twelve scoring plays.
const ARI = 'Arizona Cardinals', CAR = 'Carolina Panthers';
const EVENTS = [
  { quarter: 'Second', clock: '14:55', type: 'TD', team: ARI, player: 'Corey Kiner', detail: 'Corey Kiner 1 Yd Rush (Chad Ryland Kick)' },
  { quarter: 'Second', clock: '10:56', type: 'TD', team: CAR, player: 'AJ Dillon', detail: 'AJ Dillon 1 Yd Rush (Ryan Fitzgerald Kick)' },
  { quarter: 'Second', clock: '9:38', type: 'TD', team: ARI, player: 'Simi Fehoko', detail: 'Simi Fehoko 5 Yd pass from Carson Beck (Chad Ryland Kick)' },
  { quarter: 'Second', clock: '5:54', type: 'TD', team: CAR, player: "Ja'seem Reed", detail: "Ja'seem Reed 15 Yd pass from Haynes King (Ryan Fitzgerald Kick)" },
  { quarter: 'Second', clock: '1:46', type: 'FG', team: ARI, player: 'Chad Ryland', detail: 'Chad Ryland 35 Yd Field Goal' },
  { quarter: 'Second', clock: '0:08', type: 'FG', team: CAR, player: 'Ryan Fitzgerald', detail: 'Ryan Fitzgerald 33 Yd Field Goal' },
  { quarter: 'Third', clock: '4:42', type: 'FG', team: ARI, player: 'Chad Ryland', detail: 'Chad Ryland 43 Yd Field Goal' },
  { quarter: 'Fourth', clock: '14:20', type: 'TD', team: CAR, player: 'Anthony Tyus III', detail: 'Anthony Tyus III 5 Yd pass from Haynes King (Ryan Fitzgerald Kick)' },
  { quarter: 'Fourth', clock: '10:19', type: 'FG', team: ARI, player: 'Chad Ryland', detail: 'Chad Ryland 35 Yd Field Goal' },
  { quarter: 'Fourth', clock: '6:53', type: 'FG', team: CAR, player: 'Ryan Fitzgerald', detail: 'Ryan Fitzgerald 37 Yd Field Goal' },
  { quarter: 'Fourth', clock: '1:55', type: 'TD', team: ARI, player: 'Bryson Green', detail: 'Bryson Green 1 Yd pass from Kedon Slovis (Chad Ryland Kick)' },
  { quarter: 'Fourth', clock: '0:00', type: 'TD', team: CAR, player: 'Haynes King', detail: 'Haynes King 5 Yd Rush' },
];

// ---------------------------------------------------------------------------
// The counts, which exist because the model got them wrong
// ---------------------------------------------------------------------------

test('THE TALLIES ARE DERIVED, not left to the model to add up', () => {
  // First real run on this game, gates all green: "four field goals" about a
  // kicker who kicked three, and "five touchdowns" in a quarter that had four.
  // Neither is catchable by a gate that checks names and minutes.
  const c = countScoring(EVENTS);
  assert.equal(c.total_scoring_plays, 12);
  assert.deepEqual(c.by_quarter.Second, { TD: 4, FG: 2 }, 'four, not five');
  assert.deepEqual(c.by_quarter.Third, { FG: 1 });
  assert.deepEqual(c.by_quarter.Fourth, { TD: 3, FG: 2 });
  assert.equal(c.field_goals_by_kicker['Chad Ryland'], 3, 'three, not four');
  assert.equal(c.field_goals_by_kicker['Ryan Fitzgerald'], 2);
});

test('A PASSING TOUCHDOWN BELONGS TO THE RECEIVER, and the key name says so', () => {
  // Haynes King threw two touchdowns and ran one in. A generic "by_player"
  // invited the reading that his entry was all three, and the second run wrote
  // "three passing touchdowns" for a man with two.
  const c = countScoring(EVENTS);
  assert.equal(c.touchdowns_by_scoring_player['Haynes King'], 1, 'the run he scored');
  assert.equal(c.touchdowns_by_scoring_player["Ja'seem Reed"], 1, 'the catch, credited to the catcher');
  assert.equal(c.touchdowns_by_scoring_player['Anthony Tyus III'], 1);
  assert.equal(c.touchdowns_by_scoring_player['Chad Ryland'], undefined,
    'a kicker has no touchdowns, and an empty count is not a zero');
  assert.ok('touchdowns_by_scoring_player' in c && 'field_goals_by_kicker' in c,
    'the keys carry the semantics - the model reads them');
});

test('by_team splits the scoring the way the scoreboard did', () => {
  const c = countScoring(EVENTS);
  assert.deepEqual(c.by_team[ARI], { TD: 3, FG: 3 });   // 21 + 9 = 30
  assert.deepEqual(c.by_team[CAR], { TD: 4, FG: 2 });   // 24 + 6 = 30, plus a missed try
});

test('an empty game counts to nothing rather than throwing', () => {
  const c = countScoring([]);
  assert.equal(c.total_scoring_plays, 0);
  assert.deepEqual(c.by_quarter, {});
});

// ---------------------------------------------------------------------------
// The fallback
// ---------------------------------------------------------------------------

const ENVELOPE = {
  match: {
    league: 'NFL', round: 'Preseason · Hall of Fame Weekend',
    venue: 'Tom Benson Hall of Fame Stadium, Canton',
    teams: { home: ARI, away: CAR }, score: { home: 30, away: 33 },
  },
  events: EVENTS,
};

test('THE FALLBACK SPEAKS FOOTBALL, not minutes', () => {
  // The soccer template writes scorers as "K. Mbappe 32'". Pointed at this game
  // it would have produced "Corey Kiner 2'" - a touchdown in the second minute.
  const fb = gridironFallback(ENVELOPE);
  assert.ok(!/\d+'/.test(`${fb.headline} ${fb.paragraph_1}`), 'no apostrophe-minutes');
  assert.match(fb.paragraph_1, /Second: .*Third: .*Fourth:/s, 'grouped by quarter');
  assert.match(fb.paragraph_1, /Corey Kiner 1 Yd Rush \(Chad Ryland Kick\) \(14:55\)/,
    "the provider's own prose is the payload");
});

test('the fallback names the winner and the score, and nothing it cannot source', () => {
  const fb = gridironFallback(ENVELOPE);
  assert.match(fb.headline, /Carolina Panthers wins 33-30 over Arizona Cardinals/);
  assert.match(fb.paragraph_1, /^Carolina Panthers 33, Arizona Cardinals 30\./);
  assert.match(fb.paragraph_2, /NFL · Preseason · Hall of Fame Weekend/);
  assert.equal(fb.paragraph_3, null, 'nothing extra to say is said as nothing');
});

test('a tie does not get a winner', () => {
  const fb = gridironFallback({ ...ENVELOPE, match: { ...ENVELOPE.match, score: { home: 20, away: 20 } } });
  assert.match(fb.headline, /finish level at 20/);
  assert.ok(!/wins/.test(fb.headline));
});

test('a game with no plays still produces renderable text', () => {
  // generateGameBrief refuses to brief this case at all, but the fallback must
  // not throw on it - the two guards are independent.
  const fb = gridironFallback({ match: ENVELOPE.match, events: [] });
  assert.equal(typeof fb.headline, 'string');
  assert.equal(fb.paragraph_1, 'Carolina Panthers 33, Arizona Cardinals 30.');
});

// ---------------------------------------------------------------------------
// THE INPUT GATE - reconcileScores
// ---------------------------------------------------------------------------
// Both fixtures are the REAL envelopes from Saturday 15 Aug 2026, the night the
// fault appeared. #191 is the one that shipped a contradiction; #192 is the
// control that ran through the identical code path two minutes later and was
// correct. If the gate cannot tell these two apart it is worthless.

const KC = 'Kansas City Chiefs', LAR = 'Los Angeles Rams';
const NO = 'New Orleans Saints', JAX = 'Jacksonville Jaguars';

/** Brief #191 AS PUBLISHED: spine ends KC 9, stored score says KC 12. */
const ENV_191_BROKEN = {
  match: { teams: { home: KC, away: LAR }, score: { home: 12, away: 20 } },
  events: [
    { score_after: { [KC]: 0, [LAR]: 3 } },
    { score_after: { [KC]: 3, [LAR]: 3 } },
    { score_after: { [KC]: 3, [LAR]: 6 } },
    { score_after: { [KC]: 6, [LAR]: 6 } },
    { score_after: { [KC]: 9, [LAR]: 6 } },
    { score_after: { [KC]: 9, [LAR]: 13 } },
    { score_after: { [KC]: 9, [LAR]: 20 } },
  ],
};

/** The same game AFTER the re-fetch recovered Butker's fourth field goal. */
const ENV_191_FIXED = {
  match: ENV_191_BROKEN.match,
  events: [...ENV_191_BROKEN.events, { score_after: { [KC]: 12, [LAR]: 20 } }],
};

/** Brief #192, the control: nine events, spine agrees with the score. */
const ENV_192 = {
  match: { teams: { home: NO, away: JAX }, score: { home: 20, away: 24 } },
  events: [
    { score_after: { [NO]: 0, [JAX]: 3 } },
    { score_after: { [NO]: 7, [JAX]: 3 } },
    { score_after: { [NO]: 10, [JAX]: 3 } },
    { score_after: { [NO]: 17, [JAX]: 3 } },
    { score_after: { [NO]: 20, [JAX]: 6 } },
    { score_after: { [NO]: 20, [JAX]: 14 } },
    { score_after: { [NO]: 20, [JAX]: 17 } },
    { score_after: { [NO]: 20, [JAX]: 24 } },
    { score_after: { [NO]: 20, [JAX]: 24 } },
  ],
};

test('GATE: brief #191 as published is REFUSED - 12 stored against a 9 spine', () => {
  const r = reconcileScores(ENV_191_BROKEN);
  assert.equal(r.ok, false, 'this exact envelope must never reach the model again');
  assert.deepEqual(r.stored, { home: 12, away: 20 });
  assert.deepEqual(r.events, { home: 9, away: 20 });
  assert.deepEqual(r.delta, { home: 3, away: 0 }, 'the missing Butker field goal, in points');
});

test('GATE: brief #192 PASSES - the control that was correct on the night', () => {
  const r = reconcileScores(ENV_192);
  assert.equal(r.ok, true);
  assert.deepEqual(r.stored, r.events);
  assert.equal(r.delta.home, 0);
  assert.equal(r.delta.away, 0);
});

test('GATE: #191 passes once the re-fetch has landed the eighth play', () => {
  // The same game, the same stored score. Only the inputs got complete, which
  // is exactly the state the correction was published from.
  const r = reconcileScores(ENV_191_FIXED);
  assert.equal(r.ok, true);
  assert.deepEqual(r.events, { home: 12, away: 20 });
});

test('GATE: it reads the RUNNING SCORE, so it never prices a scoring play itself', () => {
  // A two-point conversion, a missed extra point and a safety in one game. Any
  // gate that summed by scoring_type would have to know all three; this one
  // reads a number the provider already computed.
  const A = 'A Team', B = 'B Team';
  const r = reconcileScores({
    match: { teams: { home: A, away: B }, score: { home: 8, away: 15 } },
    events: [
      { score_after: { [A]: 6, [B]: 0 } },   // TD, extra point missed
      { score_after: { [A]: 6, [B]: 8 } },   // TD + two-point conversion
      { score_after: { [A]: 8, [B]: 8 } },   // safety
      { score_after: { [A]: 8, [B]: 15 } },  // TD + kick
    ],
  });
  assert.equal(r.ok, true);
});

test('GATE: MAX not LAST, so a shuffled event list still reconciles', () => {
  const shuffled = { match: ENV_192.match, events: [...ENV_192.events].reverse() };
  assert.equal(reconcileScores(shuffled).ok, true,
    'ordering is not something the gate should be able to fail on');
});

test('GATE: no stored score is a REFUSAL, not a pass', () => {
  const r = reconcileScores({
    match: { teams: { home: KC, away: LAR }, score: { home: null, away: null } },
    events: ENV_191_BROKEN.events,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no stored score');
});

test('GATE: INDETERMINATE PASSES, and says so rather than pretending it checked', () => {
  // A provider that omits running scores leaves nothing to compare. Refusing
  // every such game would trade one silent fault for a louder one.
  const r = reconcileScores({
    match: { teams: { home: KC, away: LAR }, score: { home: 12, away: 20 } },
    events: [{ score_after: null }, { score_after: undefined }, {}],
  });
  assert.equal(r.ok, true);
  assert.equal(r.indeterminate, true);
  assert.equal(r.events, null);
});

test('GATE: an empty or absent envelope does not throw', () => {
  assert.equal(reconcileScores({}).ok, false);
  assert.equal(reconcileScores(null).ok, false);
  assert.equal(reconcileScores(undefined).ok, false);
});

test('GATE: a team name mismatch cannot be read as a zero', () => {
  // score_after is keyed by team NAME. If the envelope's teams block disagrees
  // with the event keys, the lookup yields undefined - which must be skipped,
  // never coerced to 0 and reported as a confident mismatch.
  const r = reconcileScores({
    match: { teams: { home: 'Renamed Chiefs', away: LAR }, score: { home: 12, away: 20 } },
    events: ENV_191_BROKEN.events,
  });
  assert.equal(r.indeterminate, true, 'unreadable is indeterminate, not a false alarm');
  assert.equal(r.ok, true);
});

test('GATE: the refused envelope still produces a publishable template', () => {
  // The point of refusing is that something honest publishes instead.
  const fb = gridironFallback({
    match: { teams: { home: KC, away: LAR }, score: { home: 12, away: 20 }, venue: 'Arrowhead' },
    events: [{ quarter: 'Fourth', clock: '1:58', detail: 'Harrison Butker 26 Yd Field Goal' }],
  });
  assert.match(fb.headline, /Los Angeles Rams wins 20-12 over Kansas City Chiefs/);
  assert.match(fb.paragraph_1, /Los Angeles Rams 20, Kansas City Chiefs 12/);
  assert.match(fb.paragraph_1, /Harrison Butker 26 Yd Field Goal/);
});
