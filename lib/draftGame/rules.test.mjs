// lib/draftGame/rules.test.mjs - the per-game Draft room, pure (thu-3 S1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEATS, ROUNDS, TOTAL_PICKS, COUNT_BEST, CLOCK_SECONDS, COPY,
  seatAt, roundOf, roomState, botPick, botSeed, autoPick, advanceBots, completeRoom,
  sweepClock, bestOf, gameLocked, roomHeader, byProjection, seatLabels,
} from './rules.js';
import { POOL_MIN } from './pool.js';

// A board of `n` players with distinct projections (n, n-1, ... 1).
const board = (n = POOL_MIN) => Array.from({ length: n }, (_, i) => ({
  id: 1000 + i, name: `P${String(i).padStart(2, '0')}`, pos: ['QB', 'RB', 'WR', 'TE'][i % 4], team: i % 2 ? 'AAA' : 'BBB', proj: n - i,
}));

test('the ruled shape: 4 seats, 4 picks each, best 3 count, 30 s clock', () => {
  assert.equal(SEATS, 4); assert.equal(ROUNDS, 4); assert.equal(TOTAL_PICKS, 16);
  assert.equal(COUNT_BEST, 3); assert.equal(CLOCK_SECONDS, 30);
  assert.ok(POOL_MIN >= TOTAL_PICKS, 'a board always has a player for every pick');
});

test('snake order over 4 seats', () => {
  const order = Array.from({ length: TOTAL_PICKS }, (_, i) => seatAt(i + 1));
  assert.deepEqual(order, [1, 2, 3, 4, 4, 3, 2, 1, 1, 2, 3, 4, 4, 3, 2, 1]);
  assert.equal(roundOf(1), 1); assert.equal(roundOf(4), 1); assert.equal(roundOf(5), 2); assert.equal(roundOf(16), 4);
});

test('bots never stall: every seat, many boards, the room always fills 16 picks', () => {
  for (let contestId = 1; contestId <= 60; contestId += 1) {
    for (let userSeat = 1; userSeat <= SEATS; userSeat += 1) {
      const b = board(POOL_MIN + (contestId % 11));
      const first = advanceBots(b, [], { contestId, userSeat });
      // The bots stop exactly at the human's first turn.
      assert.equal(first.length, userSeat - 1);
      assert.ok(first.every((p) => p.by === 'bot'));
      const rest = completeRoom(b, first, { contestId, userSeat });
      const st = roomState(b, [...first, ...rest]);
      assert.equal(st.done, true);
      for (let s = 1; s <= SEATS; s += 1) assert.equal(st.rosters[s].length, ROUNDS);
      assert.ok(rest.filter((p) => p.seat === userSeat).every((p) => p.by === 'auto'));
    }
  }
});

test('a bot picks one of the top three by projection, deterministically', () => {
  const avail = byProjection(board(20));
  for (let n = 1; n <= 200; n += 1) {
    const seed = botSeed({ contestId: 7, userSeat: 2, n });
    const p = botPick(avail, seed);
    assert.ok(avail.slice(0, 3).includes(p));
    assert.equal(botPick(avail, seed), p, 'same dice, same pick');
  }
  assert.equal(botPick([], 1), null);
  assert.equal(botPick(avail.slice(0, 1), 9), avail[0]);
});

test('auto-pick is the top projection still available', () => {
  const b = board(20);
  const st = roomState(b, [{ n: 1, seat: 1, id: 1000, by: 'user' }]);
  assert.equal(autoPick(st.available).id, 1001);
});

test('roomState refuses a room that does not replay', () => {
  const b = board(20);
  assert.throws(() => roomState(b, [{ n: 1, seat: 2, id: 1000 }]), /made by seat 2/);
  assert.throws(() => roomState(b, [{ n: 1, seat: 1, id: 1 }]), /not on this board/);
  assert.throws(() => roomState(b, [{ n: 1, seat: 1, id: 1000 }, { n: 2, seat: 2, id: 1000 }]), /taken twice/);
});

test('the clock: an expired turn auto-picks, the bots answer, the next clock runs from the old deadline', () => {
  const b = board(20);
  const ctx = { contestId: 3, userSeat: 1 };
  const t0 = new Date('2030-01-01T00:00:00Z');
  const deadline = new Date(t0.getTime() + 30_000).toISOString();
  // Not expired: nothing happens.
  assert.deepEqual(sweepClock(b, [], deadline, { ...ctx, now: t0 }), { made: [], deadline });
  // 31 s later: one auto-pick, then bots to the user's next turn (picks 2-7).
  const r = sweepClock(b, [], deadline, { ...ctx, now: new Date(t0.getTime() + 31_000) });
  assert.equal(r.made[0].by, 'auto');
  assert.equal(r.made[0].id, 1000);
  assert.equal(r.made.length, 1 + 6);
  assert.equal(r.deadline, new Date(t0.getTime() + 60_000).toISOString());
  // Gone for ten minutes: the whole room completes, no clock left.
  const all = sweepClock(b, [], deadline, { ...ctx, now: new Date(t0.getTime() + 600_000) });
  assert.equal(roomState(b, all.made).done, true);
  assert.equal(all.deadline, null);
});

test('best 3 of 4 count', () => {
  assert.equal(bestOf([10, 2, 7, 5]), 22);
  assert.equal(bestOf([10, null, undefined, 4]), 14);
  assert.equal(bestOf([]), 0);
});

test('lock at kickoff: `>=` at the boundary, and any non-scheduled status locks', () => {
  const k = '2030-01-01T18:00:00Z';
  assert.equal(gameLocked({ status: 'scheduled', kickoff_at: k }, new Date('2030-01-01T17:59:59Z')), false);
  assert.equal(gameLocked({ status: 'scheduled', kickoff_at: k }, new Date(k)), true);
  assert.equal(gameLocked({ status: 'live', kickoff_at: k }, new Date('2030-01-01T12:00:00Z')), true);
  assert.equal(gameLocked({ status: 'postponed', kickoff_at: k }, new Date('2030-01-01T12:00:00Z')), true);
});

test('the copy, as ruled', () => {
  assert.equal(COPY.listTitle, 'Draft one game.');
  assert.equal(COPY.listSub, 'Four drafters, four picks each. Your best three score. Over when the game ends.');
  assert.equal(COPY.count, 'Best 3 of 4 count');
  assert.equal(COPY.poolFoot, "Pool: both teams' players.");
  const b = board(20);
  const st = roomState(b, advanceBots(b, [], { contestId: 1, userSeat: 2 }));
  assert.equal(roomHeader(st, 2), 'Round 1 of 4 · your pick');
  assert.equal(roomHeader(st, 3), 'Round 1 of 4');
});

test('bots are Bot A, B, C in seat order, skipping yours', () => {
  assert.deepEqual(seatLabels(3), { 1: 'Bot A', 2: 'Bot B', 3: 'You', 4: 'Bot C' });
  assert.deepEqual(seatLabels(1), { 1: 'You', 2: 'Bot A', 3: 'Bot B', 4: 'Bot C' });
});
