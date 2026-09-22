// lib/october/rules.test.mjs - the five rules, and every refusal a card can hit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOTS, MAX_PER_GAME, CARD_SIZE, DNF, kindOf, cardSizeFor, slotsFor,
  lockedSlots, dayState, refuseReason, cardProgress, nextLock,
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
  assert.equal(MAX_PER_GAME, 2);
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

test('MAX TWO FROM ONE GAME, and a replacement does not count against itself', () => {
  const two = { bat1: p(1, 2), bat2: p(2, 2) };
  assert.equal(refuseReason(two, 'bat3', { ...p(3, 2), kind: 'bat' }, { board: BOARD, now: BEFORE }), 'max_two_from_game');
  // A third from a DIFFERENT game is fine.
  assert.equal(refuseReason(two, 'bat3', { ...p(3, 3), kind: 'bat' }, { board: BOARD, now: BEFORE }), null);
  // OVERWRITING ONE OF THE TWO with another from the same game is fine - the
  // slot being replaced must not count against its own replacement.
  assert.equal(refuseReason(two, 'bat2', { ...p(3, 2), kind: 'bat' }, { board: BOARD, now: BEFORE }), null);
  // The arm counts toward the two as well - it is a player from that game.
  const armPlusOne = { arm: p(10, 2), bat1: p(1, 2) };
  assert.equal(refuseReason(armPlusOne, 'bat2', { ...p(3, 2), kind: 'bat' }, { board: BOARD, now: BEFORE }), 'max_two_from_game');
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

test('THE BURN: used once, gone for the rest of October', () => {
  const used = new Set(['7']);
  assert.equal(refuseReason({}, 'bat1', { ...p(7, 1), kind: 'bat' }, { board: BOARD, used, now: BEFORE }), 'used');
  // Compared as strings: a jsonb lineup gives back numbers and the read may
  // give back either.
  assert.equal(refuseReason({}, 'bat1', { ...p('7', 1), kind: 'bat' }, { board: BOARD, used, now: BEFORE }), 'used');
  assert.equal(refuseReason({}, 'bat1', { ...p(8, 1), kind: 'bat' }, { board: BOARD, used, now: BEFORE }), null);
  // AND NOT TWICE ON ONE CARD EITHER, which the burn would only catch tomorrow.
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

test('TWO RULES COLLIDE ON A SHORT SLATE, and the card shrinks rather than lying', () => {
  // "One arm and four bats" wants five. "Max two from one game" caps a day at
  // 2 x games. On a TWO-game day that is four and on a ONE-game day it is
  // two - so a five-slot card is arithmetically impossible and EVERY entry
  // would be a DNF through no fault of the reader.
  //
  // COUNTED AGAINST THE REAL 2025 BRACKET: 21 of its 26 days had fewer than
  // three games, eleven of them exactly one. This is most of October, not a
  // corner case.
  assert.equal(cardSizeFor(BOARD), 5, 'four games is eight slots of room, capped at the card');
  assert.equal(cardSizeFor(BOARD.slice(0, 3)), 5);
  assert.equal(cardSizeFor(BOARD.slice(0, 2)), 4);
  assert.equal(cardSizeFor(BOARD.slice(0, 1)), 2, 'a World Series day');
  assert.equal(cardSizeFor([]), 0);
  assert.deepEqual(slotsFor(BOARD.slice(0, 1)), ['arm', 'bat1']);
  assert.deepEqual(slotsFor(BOARD.slice(0, 2)), ['arm', 'bat1', 'bat2', 'bat3']);

  // AND DNF GOES BACK TO MEANING WHAT IT SHOULD on those days: a full card of
  // two on a one-game day is COMPLETE, not a DNF.
  const one = BOARD.slice(0, 1);
  const two = { arm: p(10, 1), bat1: p(1, 1) };
  assert.equal(dayState(two, one, new Date('2026-09-30T06:00:00Z')).state, 'complete');
  assert.equal(dayState({ arm: p(10, 1) }, one, new Date('2026-09-30T06:00:00Z')).state, DNF);
  // The header counts the day's own size, not five.
  assert.equal(cardProgress(two, one, new Date('2026-09-29T16:00:00Z')).total, 2);
  // THE CAP IS NEVER RELAXED - that is the rule this preserves.
  assert.equal(refuseReason(two, 'bat2', { ...p(5, 1), kind: 'bat' },
    { board: one, now: BEFORE }), 'max_two_from_game');
});
