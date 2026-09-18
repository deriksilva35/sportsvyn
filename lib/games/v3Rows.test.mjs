// lib/games/v3Rows.test.mjs - THE FOUR ROWS THE v3 SCREEN DRAWS.
//
// One line per game, and R1's rule applies to every number in it: the site
// already computes it, or it does not appear. These are pure shapes over
// readers that exist; the two that needed new arithmetic are the ones tested
// hardest here.
//
// THE PICK'EM RECORD IS THE DANGEROUS ONE. A board's results are written at
// SETTLE, so there is no live grader - and the honest mid-week record is one
// built from FINAL games only. A live game leading 21-0 is not a win, and a
// record that counted it would be a number the site does not compute.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  weeklyRowV3, pickemRecord, pickemRowV3, dailyRowV3, draftRowV3, elapsedOf, surnamesOf,
} from './v3Rows.js';

// ---------------------------------------------------------------------------
// WEEKLY: three surnames, a count, and the best of the six
// ---------------------------------------------------------------------------
const SIX = [
  { slot: 'QB', name: 'Josh Allen', points: 34.2, played: true },
  { slot: 'RB', name: 'Kenneth Walker III', points: 12.1, played: true },
  { slot: 'WR', name: 'Jaxon Smith-Njigba', points: 8.0, played: true },
  { slot: 'TE', name: 'Travis Kelce', points: 0, played: false },
  { slot: 'FLEX', name: 'Saquon Barkley', points: 0, played: false },
  { slot: 'FLEX2', name: 'Odell Beckham Jr.', points: 0, played: false },
];

test('SURNAMES, not full names - the row has one line', () => {
  assert.deepEqual(surnamesOf(SIX).slice(0, 3), ['Allen', 'Walker', 'Smith-Njigba']);
  // A suffix is not a surname. "Kenneth Walker III" is Walker, and
  // "Odell Beckham Jr." is Beckham.
  assert.equal(surnamesOf([{ name: 'Odell Beckham Jr.' }])[0], 'Beckham');
  assert.equal(surnamesOf([{ name: 'Kyle Pitts Sr.' }])[0], 'Pitts');
  // A club is not a person.
  assert.equal(surnamesOf([{ name: 'Houston Texans D/ST' }])[0], 'Texans D/ST');
});

test('the Weekly row names three and counts the rest', () => {
  const r = weeklyRowV3({ rows: SIX, state: 'set', filled: 6 });
  assert.match(r.line, /^Allen · Walker · Smith-Njigba \+3/);
  assert.equal(r.right, '6/6');
  assert.equal(r.rightLabel, 'set');
});

test('FEWER THAN THREE does not print a "+0"', () => {
  const r = weeklyRowV3({ rows: SIX.slice(0, 2), state: 'unset', filled: 2 });
  assert.match(r.line, /^Allen · Walker/);
  assert.doesNotMatch(r.line, /\+0/);
});

test('the best live player is the MAX over the six, and only once one has played', () => {
  const live = weeklyRowV3({ rows: SIX, state: 'locked', live: true, scored: 54.3, toPlay: 3, rank: 6, of: 61 });
  assert.match(live.line, /Allen 34\.2/, 'the best of the six leads the live line');
  assert.match(live.line, /3 to play/);
  assert.match(live.line, /6th of 61/);
  // Before anything has played there is no "best" to name.
  const pre = weeklyRowV3({ rows: SIX.map((r) => ({ ...r, played: false, points: 0 })), state: 'locked', live: true, scored: 0, toPlay: 6 });
  assert.doesNotMatch(pre.line, /\d+\.\d/, `invented a leader: ${pre.line}`);
});

// ---------------------------------------------------------------------------
// PICK'EM: finals only
// ---------------------------------------------------------------------------
const PICKS = { 1: 'home', 2: 'away', 3: 'home', 4: 'away', 5: 'home' };
const GAMES = [
  { id: 1, status: 'final', winner: 'home' },   // correct
  { id: 2, status: 'final', winner: 'home' },   // wrong
  { id: 3, status: 'final', winner: 'home' },   // correct
  { id: 4, status: 'live', winner: 'away' },    // LIVE - must not count
  { id: 5, status: 'scheduled', winner: null }, // pending
];

test('THE RECORD COUNTS FINAL GAMES ONLY - a live game never moves it', () => {
  const r = pickemRecord({ picks: PICKS, games: GAMES });
  assert.equal(r.correct, 2);
  assert.equal(r.played, 3, 'three finals, and the live one is not among them');
  assert.equal(r.pending, 2, 'the live game and the scheduled one are both still to come');
  // The live game's "winner" agrees with the pick; counting it would read 3-1.
  assert.notEqual(r.correct, 3, 'the live leader was counted - that is a number we do not have');
});

test('a push or a cancelled game leaves the denominator alone', () => {
  const r = pickemRecord({ picks: { 1: 'home', 2: 'away' }, games: [
    { id: 1, status: 'final', winner: 'home' },
    { id: 2, status: 'final', winner: null },   // push
  ] });
  assert.equal(r.correct, 1);
  assert.equal(r.played, 1, 'the push is off the numerator AND the denominator');
});

test('a game you did not pick is not pending against you', () => {
  const r = pickemRecord({ picks: { 1: 'home' }, games: GAMES });
  assert.equal(r.played, 1);
  assert.equal(r.pending, 0, 'unpicked games are not yours to be waiting on');
});

test('the row states both sports and the pending count', () => {
  const r = pickemRowV3({
    nfl: { record: { correct: 1, played: 1, pending: 15 } },
    cfb: { record: { correct: 0, played: 0, pending: 22 } },
  });
  assert.match(r.line, /NFL 1-0/);
  assert.match(r.line, /15 pending/);
  assert.match(r.line, /CFB 22 pending/);
});

// ---------------------------------------------------------------------------
// DAILY: elapsed, and the numbers that already exist
// ---------------------------------------------------------------------------
test('ELAPSED comes from started_at and completed_at', () => {
  assert.equal(elapsedOf({ startedAt: '2026-09-18T04:00:00Z', completedAt: '2026-09-18T04:02:43Z' }), '2:43');
  assert.equal(elapsedOf({ startedAt: '2026-09-18T04:00:00Z', completedAt: '2026-09-18T04:00:09Z' }), '0:09');
  assert.equal(elapsedOf({ startedAt: '2026-09-18T04:00:00Z', completedAt: '2026-09-18T04:10:00Z' }), '10:00');
});

test('a run with no finish has no elapsed - not a zero', () => {
  assert.equal(elapsedOf({ startedAt: '2026-09-18T04:00:00Z', completedAt: null }), null);
  assert.equal(elapsedOf({ startedAt: null, completedAt: '2026-09-18T04:02:00Z' }), null);
  assert.equal(elapsedOf({}), null);
});

test('the Daily row carries yesterday, matched and the streak', () => {
  const r = dailyRowV3({ pct: '99.7%', matched: 7, slots: 8, streak: 4, state: 'play' });
  assert.match(r.line, /yesterday 99\.7%/);
  assert.match(r.line, /7 of 8 matched/);
  assert.match(r.line, /4-day streak/);
  assert.equal(r.right, '99.7%');
});

test('NO STREAK PRINTS NO STREAK CLAUSE', () => {
  const r = dailyRowV3({ pct: '96.1%', matched: 6, slots: 8, streak: 0, state: 'play' });
  assert.doesNotMatch(r.line, /streak/);
});

// ---------------------------------------------------------------------------
// DRAFT
// ---------------------------------------------------------------------------
test('the Draft row states the pick and the rounds left when you are on the clock', () => {
  const r = draftRowV3({ state: 'drafting', onTheClock: true, pick: '7.06', roundsToGo: 2 });
  assert.match(r.line, /on the clock/);
  assert.match(r.line, /pick 7\.06/);
  assert.match(r.line, /2 rounds to go/);
  assert.equal(r.right, '7.06');
});

test('a settled room states both ranks, and the field rank only when it exists', () => {
  const withField = draftRowV3({ state: 'settled', roomRank: 2, roomOf: 12, score: 131.4, fieldRank: 4, fieldOf: 58 });
  assert.match(withField.line, /2nd in room/);
  assert.match(withField.line, /4th of 58 field/);
  // Before the contest settles there is no field board at all (Part A): the
  // clause simply does not appear.
  const noField = draftRowV3({ state: 'settled', roomRank: 2, roomOf: 12, score: 131.4 });
  assert.doesNotMatch(noField.line, /field/);
});

test('the Draft row: on the clock, roster in, scoring, settled - and "-" only when there is no room', () => {
  const clock = draftRowV3({ state: 'drafting', onTheClock: true, pick: '7.06', roundsToGo: 2 });
  assert.equal(clock.line, 'on the clock · pick 7.06 · 2 rounds to go');
  assert.equal(clock.right, '7.06');
  assert.equal(clock.tone, 'live');

  // THE STATE THAT SERVED A DASH. The room finished, the entry is stored, the
  // contest is locked and no game has scored yet. There is no best six to
  // print and there IS something to say.
  const entered = draftRowV3({ state: 'entered', rosterSize: 6, toPlay: 6 });
  assert.equal(entered.line, 'roster in · 6 players · 6 to play');
  assert.equal(entered.right, null, 'no 0.0 nobody earned');
  assert.equal(entered.tone, null);

  const live = draftRowV3({ state: 'live', bestSix: 40.8, toPlay: 5, rosterSize: 6 });
  assert.equal(live.line, 'roster in · best six 40.8 · 5 to play');
  assert.equal(live.right, '40.8');
  assert.equal(live.tone, 'live');

  const done = draftRowV3({ state: 'settled', roomRank: 2, roomOf: 12, score: 131.4, fieldRank: 4, fieldOf: 58 });
  assert.equal(done.line, '2nd in room · 131.4 · 4th of 58 field');
  assert.equal(done.tone, 'done');

  // and the blank row is still reachable, for a reader with no room at all
  const none = draftRowV3({ state: 'none' });
  assert.equal(none.line, null);
  assert.equal(none.right, null);
});
