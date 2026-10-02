import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  refuseReason, lockedSlots, clubCount, cardProgress, nextLock, slotAccepts, clearRefusal,
  roundLabel, roundShort, MAX_PER_CLUB, SLOTS, REASON_TEXT, GAME_NAME,
} from './rules.js';

const board = [
  { match_id: 1, kickoff_at: '2026-10-10T11:30:00Z', home: { abbr: 'ARS' }, away: { abbr: 'LEE' } },
  { match_id: 2, kickoff_at: '2026-10-11T15:30:00Z', home: { abbr: 'LIV' }, away: { abbr: 'MCI' } },
];
const before = new Date('2026-10-09T12:00:00Z');
const between = new Date('2026-10-10T12:00:00Z');
const ars = (id, pos = 'MID') => ({ playerId: id, matchId: 1, clubId: 42, pos });
const liv = (id, pos = 'FWD') => ({ playerId: id, matchId: 2, clubId: 40, pos });

test('the five slots and what each accepts', () => {
  assert.deepEqual(SLOTS, ['defgk', 'mid', 'fwd', 'flex1', 'flex2']);
  assert.ok(slotAccepts('defgk', 'GK') && slotAccepts('defgk', 'DEF'));
  assert.ok(!slotAccepts('defgk', 'MID'));
  assert.ok(slotAccepts('fwd', 'ATT'), 'the table says ATT');
  assert.ok(slotAccepts('flex1', 'DEF') && slotAccepts('flex2', 'ATT') && slotAccepts('flex1', 'MID'));
  // FLEX IS OUTFIELD ONLY (thu-42): a keeper fills DEF/GK and nothing else
  assert.ok(!slotAccepts('flex1', 'GK') && !slotAccepts('flex2', 'GK'));
  assert.equal(refuseReason({}, 'flex1', ars(8, 'GK'), { board, now: before }), 'wrong_position');
  assert.equal(refuseReason({}, 'defgk', ars(8, 'GK'), { board, now: before }), null);
  assert.equal(refuseReason({}, 'mid', ars(7, 'FWD'), { board, now: before }), 'wrong_position');
});

test('max two per club - the third is refused, an overwrite of one of the two is not', () => {
  assert.equal(MAX_PER_CLUB, 2);
  const lineup = { mid: ars(1), flex1: ars(2, 'DEF') };
  assert.equal(clubCount(lineup, 42), 2);
  assert.equal(refuseReason(lineup, 'flex2', ars(3, 'FWD'), { board, now: before }), 'max_from_club');
  assert.equal(refuseReason(lineup, 'flex1', ars(3, 'FWD'), { board, now: before }), null, 'replacing an ARS slot');
  assert.equal(refuseReason(lineup, 'fwd', liv(9), { board, now: before }), null);
  assert.match(REASON_TEXT.max_from_club, /2 players from one club/);
});

test('a player once; a fixture not on the board is refused', () => {
  assert.equal(refuseReason({ mid: ars(1) }, 'flex1', ars(1), { board, now: before }), 'already_on_card');
  assert.equal(refuseReason({}, 'mid', { ...ars(1), matchId: 99 }, { board, now: before }), 'not_this_week');
});

test('each slot locks at its own kickoff; swaps before it', () => {
  const lineup = { mid: ars(1), fwd: liv(2) };
  assert.deepEqual([...lockedSlots(lineup, board, between)], ['mid']);
  assert.equal(refuseReason(lineup, 'mid', ars(5), { board, now: between }), 'slot_locked');
  assert.equal(refuseReason(lineup, 'fwd', liv(6), { board, now: between }), null, 'LIV still ahead: swap allowed');
  assert.equal(refuseReason(lineup, 'flex1', ars(5), { board, now: between }), 'game_started');
  assert.equal(clearRefusal(lineup, 'mid', { board, now: between }), 'slot_locked');
  assert.equal(clearRefusal(lineup, 'fwd', { board, now: between }), null);
});

test('the CURRENT kickoff decides, never the frozen one - both directions', () => {
  const lineup = { fwd: liv(2) };
  // moved EARLIER: LIV-MCI brought forward to 11:00 on the 10th -> locked at noon
  const earlier = new Map([['2', '2026-10-10T11:00:00Z']]);
  assert.ok(lockedSlots(lineup, board, between, { kickoffBy: earlier }).has('fwd'));
  assert.equal(refuseReason({}, 'flex1', liv(3), { board, now: between, kickoffBy: earlier }), 'game_started');
  // moved LATER: ARS-LEE pushed to 18:00 -> still open at noon
  const later = new Map([['1', '2026-10-10T18:00:00Z']]);
  assert.equal(refuseReason({}, 'mid', ars(3), { board, now: between, kickoffBy: later }), null);
  assert.ok(!lockedSlots({ mid: ars(1) }, board, between, { kickoffBy: later }).has('mid'));
});

test('a postponed fixture is unpickable and never seals a slot', () => {
  const statusBy = new Map([['1', 'postponed']]);
  assert.equal(refuseReason({}, 'mid', ars(3), { board, now: before, statusBy }), 'not_played');
  assert.ok(!lockedSlots({ mid: ars(1) }, board, between, { statusBy }).has('mid'));
});

test('progress pips and the next lock', () => {
  const p = cardProgress({ mid: ars(1), fwd: liv(2) }, board, between);
  assert.deepEqual(p.pips, ['open', 'locked', 'picked', 'open', 'open']);
  assert.equal(p.filled, 2);
  assert.equal(nextLock(board, between).match_id, 2);
  assert.equal(nextLock(board, new Date('2026-10-12T00:00:00Z')), null);
});

test('the round is "Gameweek" inside the game, and the game is "EPL Weekly 5"', () => {
  assert.equal(GAME_NAME, 'EPL Weekly 5');
  assert.equal(roundLabel(6), 'Gameweek 6');
  assert.equal(roundShort(6), 'GW 6');
});
