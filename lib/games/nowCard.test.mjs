// lib/games/nowCard.test.mjs - THE ONE THING TO DO NOW.
//
// The Games v3 mock leads with a single card that names ONE thing, and the
// whole design rests on it choosing the right one. The precedence is ruled:
//
//   graded Daily overnight > an open Daily not yet played > on the clock in a
//   room > a live game of yours > graded week > nothing
//
// EVERY BRANCH IS A STATE THE SITE ALREADY COMPUTES. Nothing here reads a
// database: it is a pure function over the view lobbyV2() already builds, so
// the card cannot invent a state the rows below it do not have.
//
// AND FRESHNESS BREAKS TIES, NOT ORDER OF WRITING. Two graded things on one
// morning - the Daily and last week's results - are ranked by their own
// timestamps, so "graded overnight" means what it says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nowCard, NOW_KINDS } from './nowCard.js';

const T = (iso) => new Date(iso).toISOString();
const NOW = T('2026-09-18T13:00:00Z');

const dailyGraded = {
  state: 'done', closesAt: T('2026-09-18T04:00:00Z'),
  stats: [{ label: 'Yesterday', value: '99.7' }],
};
const dailyOpen = { state: 'play', closesAt: T('2026-09-19T04:00:00Z') };
const dailyDone = { state: 'done', closesAt: T('2026-09-19T04:00:00Z') };
const draftClock = { state: 'drafting', onTheClock: true, pick: '7.06', roundsToGo: 2, deadlineAt: T('2026-09-18T12:59:40Z') };
const draftIdle = { state: 'locked' };
const weeklyLive = { state: 'locked', live: true, scored: 48.2, toPlay: 3, rank: 14, of: 61 };
const weeklySettled = { state: 'settled', settledAt: T('2026-09-16T12:00:00Z'), rank: 3, of: 61, score: 141.6 };

test('NOTHING is a state, not a crash', () => {
  const c = nowCard({}, { now: NOW });
  assert.equal(c.kind, 'nothing');
  assert.equal(c.done, true, 'nothing to do reads as done, never as an ask');
});

test('a graded Daily overnight WINS - it is the first thing you want', () => {
  const c = nowCard({ daily: dailyGraded, weekly: weeklySettled, draft: draftIdle }, { now: NOW });
  assert.equal(c.kind, 'daily-graded');
  assert.equal(c.done, true, 'a result is grey: it asks for nothing');
});

test('an OPEN Daily beats a room and a live game', () => {
  const c = nowCard({ daily: dailyOpen, draft: draftClock, weekly: weeklyLive }, { now: NOW });
  assert.equal(c.kind, 'daily-open');
  assert.equal(c.done, false, 'it asks for something, so it is volt');
});

test('ON THE CLOCK beats a live game of yours', () => {
  // A pick expires; a live game does not. This is the only branch with a
  // deadline behind it, and it is the one that costs you something.
  const c = nowCard({ daily: dailyDone, draft: draftClock, weekly: weeklyLive }, { now: NOW });
  assert.equal(c.kind, 'draft-clock');
  assert.equal(c.done, false);
});

test('a live game of yours beats a graded week', () => {
  const c = nowCard({ daily: dailyDone, draft: draftIdle, weekly: weeklyLive }, { now: NOW });
  assert.equal(c.kind, 'live');
  assert.equal(c.done, false);
});

test('a graded week is last, and it is grey', () => {
  const c = nowCard({ daily: dailyDone, draft: draftIdle, weekly: weeklySettled }, { now: NOW });
  assert.equal(c.kind, 'week-graded');
  assert.equal(c.done, true);
});

test('ALL SIX KINDS ARE REACHABLE, and the list is the contract', () => {
  assert.deepEqual(NOW_KINDS,
    ['daily-graded', 'daily-open', 'draft-clock', 'live', 'week-graded', 'nothing']);
  const seen = new Set([
    nowCard({ daily: dailyGraded }, { now: NOW }).kind,
    nowCard({ daily: dailyOpen }, { now: NOW }).kind,
    nowCard({ daily: dailyDone, draft: draftClock }, { now: NOW }).kind,
    nowCard({ daily: dailyDone, weekly: weeklyLive }, { now: NOW }).kind,
    nowCard({ daily: dailyDone, weekly: weeklySettled }, { now: NOW }).kind,
    nowCard({}, { now: NOW }).kind,
  ]);
  assert.equal(seen.size, 6, `every branch reachable, saw ${[...seen].join(', ')}`);
});

// ---------------------------------------------------------------------------
// FRESHNESS
// ---------------------------------------------------------------------------
test('THE FRESHEST GRADED THING WINS A TIE', () => {
  // A Tuesday morning: the week settled on Tuesday and the Daily graded at
  // midnight. Whichever happened LAST is the one to lead with, and it is
  // derived from the timestamps rather than from the order of the branches.
  const dailyOld = { ...dailyGraded, closesAt: T('2026-09-15T04:00:00Z') };
  const weekNew = { ...weeklySettled, settledAt: T('2026-09-18T12:00:00Z') };
  const c = nowCard({ daily: dailyOld, weekly: weekNew }, { now: NOW });
  assert.equal(c.kind, 'week-graded', 'the week settled twelve hours ago, the Daily three days ago');
  const weekOld = { ...weeklySettled, settledAt: T('2026-09-15T12:00:00Z') };
  const dailyNew = { ...dailyGraded, closesAt: T('2026-09-18T04:00:00Z') };
  assert.equal(nowCard({ daily: dailyNew, weekly: weekOld }, { now: NOW }).kind, 'daily-graded');
});

test('A STALE GRADED DAILY DOES NOT LEAD FOREVER', () => {
  // "Graded overnight" has to mean overnight. A Daily graded four days ago is
  // not the one thing to do now, and an open board beats it outright.
  const stale = { ...dailyGraded, closesAt: T('2026-09-14T04:00:00Z') };
  assert.equal(nowCard({ daily: stale, weekly: weeklyLive }, { now: NOW }).kind, 'live');
  assert.equal(nowCard({ daily: stale }, { now: NOW }).kind, 'nothing');
});

test('every card carries a label, a title, a line and a button', () => {
  for (const v of [{ daily: dailyGraded }, { daily: dailyOpen }, { daily: dailyDone, draft: draftClock },
    { daily: dailyDone, weekly: weeklyLive }, { daily: dailyDone, weekly: weeklySettled }, {}]) {
    const c = nowCard(v, { now: NOW });
    for (const k of ['kind', 'label', 'title', 'line', 'cta', 'href', 'done']) {
      assert.ok(k in c, `${c.kind} is missing ${k}`);
    }
    assert.equal(typeof c.title, 'string');
    assert.ok(c.title.length > 0, `${c.kind} has an empty title`);
  }
});

test('THE CARD NEVER INVENTS A NUMBER', () => {
  // Its line is assembled from what the view already carries. A view with no
  // numbers produces a card with no numbers, not a card with zeros.
  const c = nowCard({ daily: { state: 'play', closesAt: null } }, { now: NOW });
  assert.equal(c.kind, 'daily-open');
  assert.doesNotMatch(c.line ?? '', /\b0\b/, `invented a zero: ${c.line}`);
});

test("a stranger's Daily is OPEN, not 'nothing open'", () => {
  // lobbyV2 gives a signed-out reader state 'signed-out' on the Daily and the
  // Weekly. The board is open regardless of who is looking at it.
  const c = nowCard({
    daily: { state: 'signed-out', closesAt: '2026-09-19T04:00:00.000Z',
      shape: '8 slots · 12 teams · about 3 minutes' },
    weekly: { state: 'signed-out' }, draft: { state: 'none' },
  }, { now: new Date('2026-09-18T22:00:00Z') });
  assert.equal(c.kind, 'daily-open');
  assert.equal(c.title, 'The Daily');
  assert.equal(c.done, false);
  assert.match(c.line, /8 slots/);
  // no streak and no season are CLAIMED for someone with neither
  assert.equal(/streak/.test(c.line), false);
  assert.match(c.line, /season revealed when you start/);
});

test("'nothing open' is still reachable, and still means it", () => {
  const c = nowCard({ daily: { state: 'closed' }, weekly: { state: 'open' }, draft: { state: 'none' } });
  assert.equal(c.kind, 'nothing');
});
