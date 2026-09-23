// lib/october/rules.test.mjs - the five rules, and every refusal a card can hit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOTS, BASE_MAX_PER_GAME, CARD_SIZE, DNF, kindOf, maxPerGame,
  lockedSlots, dayState, refuseReason, cardProgress, nextLock, effectiveKickoff, isPostponed,
} from './rules.js';

// Wild Card day 1, the mock's own slate.
const BOARD = [
  { match_id: 1, slug: 'tb-nyy', kickoff_at: '2026-09-29T17:08:00Z' },
  { match_id: 2, slug: 'phi-atl', kickoff_at: '2026-09-29T18:08:00Z' },
  { match_id: 3, slug: 'det-sea', kickoff_at: '2026-09-29T22:08:00Z' },
  { match_id: 4, slug: 'sd-chc', kickoff_at: '2026-09-29T23:38:00Z' },
];
const BEFORE = new Date('2026-09-29T16:00:00Z');
const p = (playerId, matchId) => ({ playerId, matchId });

test('ONE ARM AND FOUR BATS is the shape of the card', () => {
  assert.deepEqual(SLOTS, ['arm', 'bat1', 'bat2', 'bat3', 'bat4']);
  assert.equal(CARD_SIZE, 5);
  assert.equal(BASE_MAX_PER_GAME, 2);
  assert.equal(kindOf('arm'), 'arm');
  assert.equal(SLOTS.filter((s) => kindOf(s) === 'bat').length, 4);
  // AN ARM IN A BAT SLOT IS NOT A NEAR MISS.
  assert.equal(refuseReason({}, 'bat1', { ...p(9, 1), kind: 'arm' }, { board: BOARD, now: BEFORE }), 'wrong_kind');
  assert.equal(refuseReason({}, 'arm', { ...p(9, 1), kind: 'bat' }, { board: BOARD, now: BEFORE }), 'wrong_kind');
  assert.equal(refuseReason({}, 'bat5', { ...p(9, 1), kind: 'bat' }, { board: BOARD, now: BEFORE }), 'bad_slot');
});

test('ONLY FROM TODAY\'S GAMES', () => {
  assert.equal(refuseReason({}, 'bat1', { ...p(9, 99), kind: 'bat' }, { board: BOARD, now: BEFORE }), 'not_today');
  assert.equal(refuseReason({}, 'bat1', { ...p(9, 1), kind: 'bat' }, { board: BOARD, now: BEFORE }), null);
});

test('THE PER-GAME CAP, and a replacement does not count against itself', () => {
  // Four games: ceil(5/4) is 2, so the base cap stands.
  const two = { bat1: p(1, 2), bat2: p(2, 2) };
  assert.equal(refuseReason(two, 'bat3', { ...p(3, 2), kind: 'bat' }, { board: BOARD, now: BEFORE }), 'max_from_game');
  // A third from a DIFFERENT game is fine.
  assert.equal(refuseReason(two, 'bat3', { ...p(3, 3), kind: 'bat' }, { board: BOARD, now: BEFORE }), null);
  // OVERWRITING ONE OF THE TWO with another from the same game is fine - the
  // slot being replaced must not count against its own replacement.
  assert.equal(refuseReason(two, 'bat2', { ...p(3, 2), kind: 'bat' }, { board: BOARD, now: BEFORE }), null);
  // The arm counts toward the two as well - it is a player from that game.
  const armPlusOne = { arm: p(10, 2), bat1: p(1, 2) };
  assert.equal(refuseReason(armPlusOne, 'bat2', { ...p(3, 2), kind: 'bat' }, { board: BOARD, now: BEFORE }), 'max_from_game');
});

test('THE ROLLING LOCK: the slot, and the game', () => {
  const during = new Date('2026-09-29T17:30:00Z');   // TB @ NYY has started
  const lineup = { bat1: p(1, 1), bat2: p(2, 2) };
  assert.deepEqual([...lockedSlots(lineup, BOARD, during)], ['bat1']);
  // A SEALED SLOT CANNOT BE CHANGED, even to a player from a later game.
  assert.equal(refuseReason(lineup, 'bat1', { ...p(5, 3), kind: 'bat' }, { board: BOARD, now: during }), 'slot_locked');
  // AND A STARTED GAME CANNOT BE ENTERED, even into an open slot.
  assert.equal(refuseReason(lineup, 'bat3', { ...p(5, 1), kind: 'bat' }, { board: BOARD, now: during }), 'game_started');
  // A later game is still open.
  assert.equal(refuseReason(lineup, 'bat3', { ...p(5, 3), kind: 'bat' }, { board: BOARD, now: during }), null);
  // `<=` AT THE BOUNDARY: at the stated first pitch the game has started.
  assert.equal(refuseReason({}, 'bat1', { ...p(5, 1), kind: 'bat' },
    { board: BOARD, now: new Date('2026-09-29T17:08:00Z') }), 'game_started');
});

test('THERE IS NO BURN: yesterday cannot refuse today, and a `used` set is ignored', () => {
  // THE RULE IS GONE, and this test is what used to assert it. A player spent on
  // an earlier day is offered again today - "Tomorrow is a new five".
  assert.equal(refuseReason({}, 'bat1', { ...p(7, 1), kind: 'bat' }, { board: BOARD, now: BEFORE }), null);
  // AND THE OLD ARGUMENT IS INERT. A caller left over from the burn - or a Run
  // helper reached for by mistake - cannot re-impose the rule through the door:
  // refuseReason takes no `used` and this option is simply not read.
  assert.equal(refuseReason({}, 'bat1', { ...p(7, 1), kind: 'bat' },
    { board: BOARD, used: new Set(['7']), now: BEFORE }), null);
  assert.equal(refuseReason({}, 'bat1', { ...p('7', 1), kind: 'bat' },
    { board: BOARD, used: new Set(['7', '8']), now: BEFORE }), null);
  // NOT TWICE ON ONE CARD, THOUGH. That rule is about the shape of a card, not
  // about the tournament, and it stays.
  assert.equal(refuseReason({ bat1: p(8, 1) }, 'bat2', { ...p(8, 1), kind: 'bat' },
    { board: BOARD, now: BEFORE }), 'already_on_card');
});

test('AN EMPTY SLOT AT FIRST PITCH IS A DNF, and a DNF is not a zero', () => {
  const four = { arm: p(10, 1), bat1: p(1, 1), bat2: p(2, 2), bat3: p(3, 3) };
  // While any game is still to start, an unfilled card is simply OPEN - the
  // empty slot can still be filled from a later game.
  assert.deepEqual(dayState(four, BOARD, new Date('2026-09-29T22:30:00Z')),
    { state: 'open', filled: 4 });
  // Once the LAST first pitch has passed the card can never be completed.
  assert.deepEqual(dayState(four, BOARD, new Date('2026-09-29T23:38:00Z')),
    { state: DNF, filled: 4 });
  assert.equal(DNF, 'dnf');
  // A full card is complete whatever the clock says.
  const five = { ...four, bat4: p(4, 4) };
  assert.deepEqual(dayState(five, BOARD, new Date('2026-09-30T06:00:00Z')),
    { state: 'complete', filled: 5 });
  // An untouched card after the slate is a DNF, not a zero.
  assert.equal(dayState({}, BOARD, new Date('2026-09-30T06:00:00Z')).state, DNF);
});

test('the header counts what the pips show', () => {
  const during = new Date('2026-09-29T17:30:00Z');
  const lineup = { arm: p(10, 3), bat1: p(1, 1), bat2: p(2, 2) };
  const c = cardProgress(lineup, BOARD, during);
  // The mock's own first frame: one locked, two picked, two open.
  assert.deepEqual(c.pips, ['picked', 'locked', 'picked', 'open', 'open']);
  assert.equal(c.locked, 1);
  assert.equal(c.picked, 2);
  assert.equal(c.open, 2);
  assert.equal(c.filled, 3, '"3 of 5"');
  assert.equal(c.total, 5);
});

test('THE CLOCK COUNTS TO THE NEXT LOCK, never to midnight', () => {
  // Each slot locks at its own first pitch, so the clock names the soonest
  // one a reader can still act on.
  assert.equal(nextLock(BOARD, BEFORE).slug, 'tb-nyy');
  assert.equal(nextLock(BOARD, new Date('2026-09-29T17:30:00Z')).slug, 'phi-atl');
  assert.equal(nextLock(BOARD, new Date('2026-09-29T22:30:00Z')).slug, 'sd-chc');
  // Nothing left to lock is null, not the last game again.
  assert.equal(nextLock(BOARD, new Date('2026-09-30T00:00:00Z')), null);
  assert.equal(nextLock([], BEFORE), null);
});

test('THE CAP SCALES, THE CARD DOES NOT - ceil(5 / games)', () => {
  // A fixed cap of two capped a day at 2 x games, so five was arithmetically
  // impossible on most of October: 21 of the 2025 postseason's 26 days had
  // fewer than three games, eleven had exactly one, and every World Series
  // day has one. The CAP gives instead, and the card is always five.
  assert.equal(CARD_SIZE, 5);
  assert.equal(maxPerGame(BOARD.slice(0, 1)), 5, 'a World Series day');
  assert.equal(maxPerGame(BOARD.slice(0, 2)), 3);
  assert.equal(maxPerGame(BOARD.slice(0, 3)), 2);
  assert.equal(maxPerGame(BOARD), 2);
  // IT NEVER TIGHTENS BELOW TWO. ceil(5/5) is literally 1, which would forbid
  // two from one game on a five-game day - a restriction nobody asked for and
  // the opposite of what this rule does. (MLB does not schedule five
  // postseason games in a day, so the two readings never differ in practice.)
  assert.equal(maxPerGame(new Array(5).fill(BOARD[0])), 2);
  assert.equal(maxPerGame(new Array(9).fill(BOARD[0])), 2);
  assert.equal(maxPerGame([]), 2);
});

test('A ONE-GAME DAY TAKES ALL FIVE FROM IT', () => {
  const one = BOARD.slice(0, 1);
  const now = BEFORE;
  // Five from the single game, one by one, each legal.
  let lineup = {};
  for (const [slot, id, kind] of [['arm', 10, 'arm'], ['bat1', 1, 'bat'], ['bat2', 2, 'bat'], ['bat3', 3, 'bat'], ['bat4', 4, 'bat']]) {
    assert.equal(refuseReason(lineup, slot, { ...p(id, 1), kind }, { board: one, now }), null, slot);
    lineup = { ...lineup, [slot]: p(id, 1) };
  }
  // And the finished card is COMPLETE, not a DNF.
  assert.equal(dayState(lineup, one, new Date('2026-09-30T06:00:00Z')).state, 'complete');
  assert.equal(cardProgress(lineup, one, now).total, 5);
});

test('A TWO-GAME DAY: 3+2 IS LEGAL, 4+1 IS NOT', () => {
  const two = BOARD.slice(0, 2);
  const now = BEFORE;
  // Three from game 1.
  const three = { arm: p(10, 1), bat1: p(1, 1), bat2: p(2, 1) };
  // A FOURTH from game 1 is refused - the cap is ceil(5/2) = 3.
  assert.equal(refuseReason(three, 'bat3', { ...p(3, 1), kind: 'bat' }, { board: two, now }), 'max_from_game');
  // But the fourth and fifth from game 2 are fine, and that is 3+2.
  assert.equal(refuseReason(three, 'bat3', { ...p(3, 2), kind: 'bat' }, { board: two, now }), null);
  const full = { ...three, bat3: p(3, 2), bat4: p(4, 2) };
  assert.equal(dayState(full, two, new Date('2026-09-30T06:00:00Z')).state, 'complete');
  // AND THE OTHER WAY ROUND TOO - 2+3 is the same rule.
  const twoThree = { arm: p(10, 1), bat1: p(1, 1), bat2: p(2, 2), bat3: p(3, 2) };
  assert.equal(refuseReason(twoThree, 'bat4', { ...p(4, 2), kind: 'bat' }, { board: two, now }), null);
  assert.equal(refuseReason(twoThree, 'bat4', { ...p(4, 1), kind: 'bat' }, { board: two, now }), null,
    'a third from game 1 is still inside the cap of three');
});

// --- A POSTPONED GAME ------------------------------------------------------

test('a postponed game is NOT a lock candidate, and comes back when it is not', () => {
  const board = [
    { match_id: 1, slug: 'tor-bal', kickoff_at: '2026-09-22T22:35:00Z' },
    { match_id: 2, slug: 'chw-kc', kickoff_at: '2026-09-22T23:40:00Z' },
  ];
  const now = new Date('2026-09-22T21:00:00Z');
  // Without a status map nothing has changed: the earlier game is next.
  assert.equal(nextLock(board, now)?.slug, 'tor-bal');
  // Called off: its first pitch is a time nothing will happen at, so the clock
  // must count to the real next lock instead of to a deadline that never comes.
  const statusBy = new Map([['1', 'postponed'], ['2', 'scheduled']]);
  assert.equal(nextLock(board, now, { statusBy })?.slug, 'chw-kc');
  // Rescheduled to Thursday: it is a candidate again, at its NEW time.
  const back = new Map([['1', 'scheduled'], ['2', 'scheduled']]);
  const kickoffBy = new Map([['1', '2026-09-24T22:35:00Z']]);
  assert.equal(nextLock(board, now, { statusBy: back, kickoffBy })?.slug, 'chw-kc',
    'Thursday is after Tuesday night, so the Tuesday game locks first');
  assert.equal(nextLock([board[0]], now, { statusBy: back, kickoffBy })?.slug, 'tor-bal');
});

test('isPostponed reads either shape, and an unknown status is "as scheduled"', () => {
  // A Map at read time, a plain object from a serialised payload - both, because
  // the callers differ and an absent status must never read as "called off".
  assert.equal(isPostponed(new Map([['1', 'postponed']]), 1), true);
  assert.equal(isPostponed({ 1: 'postponed' }, '1'), true);
  assert.equal(isPostponed(new Map([['1', 'scheduled']]), 1), false);
  assert.equal(isPostponed(new Map(), 1), false);
  assert.equal(isPostponed(null, 1), false);
});

test('effectiveKickoff takes the LATER time, never the earlier one', () => {
  // A reschedule may GRANT editing time and must never STEAL it - the 067 law.
  const frozen = '2026-09-22T22:35:00Z';
  assert.equal(effectiveKickoff(frozen, '2026-09-24T22:35:00Z'), Date.parse('2026-09-24T22:35:00Z'));
  assert.equal(effectiveKickoff(frozen, '2026-09-22T20:00:00Z'), Date.parse(frozen),
    'moved earlier: the reader keeps the time they planned against');
  assert.equal(effectiveKickoff(frozen, null), Date.parse(frozen));
  assert.equal(effectiveKickoff(null, frozen), Date.parse(frozen));
  assert.ok(Number.isNaN(effectiveKickoff(null, null)));
});

test('the save door refuses a postponed game, and allows it once rescheduled', () => {
  const board = [{ match_id: 1, slug: 'tor-bal', kickoff_at: '2026-09-22T22:35:00Z' }];
  const now = new Date('2026-09-22T21:00:00Z');
  const pick = { playerId: 9, matchId: 1, kind: 'bat' };
  assert.equal(refuseReason({}, 'bat1', pick, { board, now }), null);
  assert.equal(refuseReason({}, 'bat1', pick, {
    board, now, statusBy: new Map([['1', 'postponed']]),
  }), 'postponed');
  // Rescheduled: the status is 'scheduled' again and the new first pitch is
  // ahead, so it saves - even though the board's frozen time has passed.
  const later = new Date('2026-09-23T06:00:00Z');
  assert.equal(refuseReason({}, 'bat1', pick, { board, now: later }), 'game_started');
  assert.equal(refuseReason({}, 'bat1', pick, {
    board, now: later,
    statusBy: new Map([['1', 'scheduled']]),
    kickoffBy: new Map([['1', '2026-09-24T22:35:00Z']]),
  }), null);
});

test('a day with a postponed game on it is OPEN, not a DNF', () => {
  const board = [{ match_id: 1, slug: 'tor-bal', kickoff_at: '2026-09-22T22:35:00Z' }];
  const after = new Date('2026-09-23T06:00:00Z');
  // Every first pitch has passed, so an unfilled card would normally be a DNF.
  assert.equal(dayState({}, board, after).state, 'dnf');
  // But the game was called off - the chance has not passed, it has moved, and
  // the settle already waits for the makeup. The reader's state must agree.
  assert.equal(dayState({}, board, after, { statusBy: new Map([['1', 'postponed']]) }).state, 'open');
});

test('a slot in a rescheduled game is not sealed by the old first pitch', () => {
  const board = [{ match_id: 1, slug: 'tor-bal', kickoff_at: '2026-09-22T22:35:00Z' }];
  const lineup = { bat1: { playerId: 9, matchId: 1 } };
  const after = new Date('2026-09-23T06:00:00Z');
  assert.equal(lockedSlots(lineup, board, after).has('bat1'), true);
  assert.equal(
    lockedSlots(lineup, board, after, { kickoffBy: new Map([['1', '2026-09-24T22:35:00Z']]) }).has('bat1'),
    false, 'the game has not been played, so the slot is not sealed');
});
