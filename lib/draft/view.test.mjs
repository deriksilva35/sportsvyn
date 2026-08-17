// lib/draft/view.test.mjs - The Draft's state machine and views. PURE.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { draftState, seatOptions, draftSettledView, draftHomeView } = await import('./view.js');
const { tierFor } = await import('../daily/reveal.js');

const LOCKS = '2026-09-10T00:20:00Z';
const OPENS = '2026-09-08T13:00:00Z';
const OPEN = { season_year: 2026, week: 1, opens_at: OPENS, locks_at: LOCKS, settled: false };
const during = new Date('2026-09-09T12:00:00Z');
const after = new Date('2026-09-13T12:00:00Z');
const wire = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------------------
// THE STATE MACHINE
// ---------------------------------------------------------------------------

test('no contest renders nothing', () => {
  assert.equal(draftState({ contest: null }), 'none');
});

test('rules until an entry exists', () => {
  assert.equal(draftState({ contest: OPEN, entry: null, now: during }), 'rules');
});

test('DRAFTING is the state the Weekly could not have had', () => {
  // A weekly lineup is edited over days and every save is complete in itself.
  // A draft room is a SESSION - a reload mid-draft must land back in the room.
  assert.equal(draftState({
    contest: OPEN, entry: { id: 1 }, draft: { status: 'in_progress' }, now: during,
  }), 'drafting');
});

test('a finished room is WAITING, not still drafting', () => {
  assert.equal(draftState({
    contest: OPEN, entry: { id: 1 }, draft: { status: 'completed' }, now: during,
  }), 'waiting');
});

test('AN ENTRY WITH NO ROOM CANNOT GO BACK TO RULES - start is consumed', () => {
  // Otherwise abandoning a room would offer a second draft, which is a free
  // look at the board. Same reason the Daily consumes the attempt.
  assert.equal(draftState({ contest: OPEN, entry: { id: 1 }, draft: null, now: during }), 'waiting');
});

test('the lock boundary is inclusive, matching every other game', () => {
  const t = new Date(LOCKS).getTime();
  const e = { id: 1 };
  assert.equal(draftState({ contest: OPEN, entry: e, draft: { status: 'in_progress' }, now: new Date(t - 1) }), 'drafting');
  assert.equal(draftState({ contest: OPEN, entry: e, draft: { status: 'in_progress' }, now: new Date(t) }), 'locked');
});

test('settled beats everything', () => {
  assert.equal(draftState({ contest: { ...OPEN, settled: true }, now: during }), 'settled');
});

// ---------------------------------------------------------------------------
// THE SEAT DOOR
// ---------------------------------------------------------------------------

test('every seat is offered, and the two that play differently are named', () => {
  const s = seatOptions(12);
  assert.equal(s.length, 12);
  assert.deepEqual(s.map((x) => x.seat), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.ok(s[0].note, 'first overall has a trade worth naming');
  assert.ok(s[11].note, 'the turn has a trade worth naming');
  assert.equal(s[5].note, null, 'a middle seat has nothing special to say');
});

test('seatOptions survives a nonsense team count', () => {
  assert.deepEqual(seatOptions(0), []);
  assert.deepEqual(seatOptions(null), []);
});

// ---------------------------------------------------------------------------
// THE HOMEPAGE MODULE - what must never reach it
// ---------------------------------------------------------------------------

test('NO SCORE EXISTS BEFORE SETTLE, in any pre-settle state', () => {
  for (const [label, args] of [
    ['rules', { contest: OPEN, entry: null, now: during }],
    ['drafting', { contest: OPEN, entry: { id: 1 }, draft: { status: 'in_progress' }, now: during }],
    ['waiting', { contest: OPEN, entry: { id: 1, meta: { roster: [{ id: 1 }] } }, draft: { status: 'completed' }, now: during }],
    ['locked', { contest: OPEN, entry: { id: 1, meta: { roster: [{ id: 1 }] } }, now: after }],
  ]) {
    const v = wire(draftHomeView(args));
    for (const k of ['score', 'perfect', 'tier', 'pct']) {
      assert.equal(k in v, false, `${label} must not carry ${k}`);
    }
  }
});

test('THE ROSTER NEVER REACHES THE HOMEPAGE - only a count', () => {
  const roster = [{ id: 8801, name: 'A Player', pos: 'RB' }, { id: 8802, name: 'B', pos: 'WR' }];
  const s = JSON.stringify(draftHomeView({
    contest: OPEN, entry: { id: 1, meta: { roster } }, draft: { status: 'completed' }, now: during,
  }));
  assert.equal(s.includes('8801'), false);
  assert.equal(s.includes('A Player'), false);
  assert.equal(s.includes('"picks":2'), true, 'the count is what the module needs');
});

test('a board that has not opened renders nothing', () => {
  assert.equal(draftHomeView({ contest: OPEN, now: new Date('2026-09-07T00:00:00Z') }), null);
  assert.equal(draftHomeView({ contest: null }), null);
});

test('settled carries the score on the DAILY TIER LADDER', () => {
  // Same ladder as the Daily and the Weekly, which is what makes a Draft PRO
  // BOWLER worth the same season points as a Weekly one.
  const c = { ...OPEN, settled: true, perfect: { total: 140 } };
  const v = draftHomeView({ contest: c, entry: { score: 91.2 }, now: after });
  assert.equal(v.state, 'settled');
  assert.equal(v.tier, tierFor(91.2, 140).label);
  assert.equal(v.pct, 65);
});

test('a DNF gets the perfect as the yardstick, never a zero', () => {
  const c = { ...OPEN, settled: true, perfect: { total: 140 } };
  const v = draftHomeView({ contest: c, entry: { score: null }, now: after });
  assert.equal(v.played, false);
  assert.equal('score' in v, false);
});

// ---------------------------------------------------------------------------
// THE SETTLED VIEW
// ---------------------------------------------------------------------------

test('the settled view marks which of the roster actually started', () => {
  // In best ball the bench is the interesting part: those are the points the
  // draft did not need.
  const board = [
    { id: 1, name: 'QB', pos: 'QB', points: 25 },
    { id: 2, name: 'RB', pos: 'RB', points: 18 },
    { id: 3, name: 'Bench WR', pos: 'WR', points: 2 },
  ];
  const entry = {
    score: 43, meta: { roster: [{ id: 1, pos: 'QB' }, { id: 2, pos: 'RB' }, { id: 3, pos: 'WR' }] },
    lineup: { QB: 1, RB: 2 },
  };
  const v = draftSettledView({ contest: { ...OPEN, settled: true, perfect: { total: 100 } }, entry, board });
  const started = v.roster.filter((r) => r.started).map((r) => r.id);
  assert.deepEqual(started, [1, 2]);
  assert.equal(v.roster.find((r) => r.id === 3).started, false);
  assert.equal(v.roster.find((r) => r.id === 3).points, 2, 'the bench still shows what it scored');
});

test('a DNF renders no scoreline', () => {
  const v = draftSettledView({
    contest: { ...OPEN, settled: true, perfect: { total: 100 } },
    entry: { score: null, meta: { roster: [] } }, board: [],
  });
  assert.equal(v.you, null);
  assert.equal(v.dnf, true);
});
