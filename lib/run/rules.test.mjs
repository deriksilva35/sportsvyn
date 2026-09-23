// lib/run/rules.test.mjs - the nine, and every refusal a roster can hit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOTS, ARM_SLOTS, BAT_SLOTS, ROSTER_SIZE, MAX_PER_CLUB, ROUNDS, DNF,
  kindOf, roundOf, weekOf, isLocked, rosterState, refuseReason,
  clubCounts, progress, roundPips, roundLockAt,
} from './rules.js';

// The mock's own Wild Card board: eight alive, four on a bye.
const CLUBS = [
  { teamId: 1, abbr: 'TB', seed: 3, bye: false }, { teamId: 2, abbr: 'CHW', seed: 6, bye: false },
  { teamId: 3, abbr: 'NYY', seed: 4, bye: false }, { teamId: 4, abbr: 'BOS', seed: 5, bye: false },
  { teamId: 5, abbr: 'TEX', seed: 1, bye: true }, { teamId: 6, abbr: 'CLE', seed: 2, bye: true },
  { teamId: 7, abbr: 'ATL', seed: 3, bye: false }, { teamId: 8, abbr: 'PHI', seed: 6, bye: false },
  { teamId: 9, abbr: 'CHC', seed: 4, bye: false }, { teamId: 10, abbr: 'SD', seed: 5, bye: false },
  { teamId: 11, abbr: 'MIL', seed: 1, bye: true }, { teamId: 12, abbr: 'LAD', seed: 2, bye: true },
];
const BOARD = { round: 'wild_card', firstPitch: '2026-09-29T14:05:00Z', clubs: CLUBS };
const BEFORE = new Date('2026-09-29T10:00:00Z');
const AFTER = new Date('2026-09-29T14:05:00Z');
const p = (playerId, teamId, kind = 'bat') => ({ playerId: String(playerId), teamId, kind });

test('NINE: two arms and seven bats, a 3x3 field', () => {
  assert.equal(ROSTER_SIZE, 9);
  assert.deepEqual(ARM_SLOTS, ['arm1', 'arm2']);
  assert.equal(BAT_SLOTS.length, 7);
  assert.equal(SLOTS.length, 9);
  assert.equal(MAX_PER_CLUB, 3);
  assert.equal(kindOf('arm1'), 'arm');
  assert.equal(kindOf('bat7'), 'bat');
  assert.equal(kindOf('bat8'), null);
  // AN ARM IN A BAT SLOT IS A DIFFERENT TEAM, not a near miss.
  assert.equal(refuseReason({}, 'bat1', p(1, 1, 'arm'), { board: BOARD, now: BEFORE }), 'wrong_kind');
  assert.equal(refuseReason({}, 'arm1', p(1, 1, 'bat'), { board: BOARD, now: BEFORE }), 'wrong_kind');
  assert.equal(refuseReason({}, 'bat9', p(1, 1), { board: BOARD, now: BEFORE }), 'bad_slot');
});

test('THE FOUR ROUNDS ARE THE BRACKET\'S, and week is their key', () => {
  assert.deepEqual(ROUNDS, ['wild_card', 'division', 'championship', 'world_series']);
  assert.deepEqual(ROUNDS.map(weekOf), [1, 2, 3, 4]);
  assert.equal(roundOf(1), 'wild_card');
  assert.equal(roundOf(4), 'world_series');
  assert.equal(roundOf(5), null);
  assert.equal(weekOf('group'), null, 'a World Cup stage is not a round of this bracket');
});

test('A BYE CLUB IS NOT IN THE ROUND-1 POOL, and says so by name', () => {
  // "The 1 and 2 seeds sit this round out" - the mock's own note, and the
  // grid dims them rather than hiding them.
  assert.equal(refuseReason({}, 'bat1', p(1, 5), { board: BOARD, now: BEFORE }), 'club_has_bye');
  assert.equal(refuseReason({}, 'bat1', p(1, 11), { board: BOARD, now: BEFORE }), 'club_has_bye');
  // An alive club is fine.
  assert.equal(refuseReason({}, 'bat1', p(1, 1), { board: BOARD, now: BEFORE }), null);
  // A club that is not on the board at all is a different refusal - it was
  // eliminated, or it was never in this round.
  assert.equal(refuseReason({}, 'bat1', p(1, 99), { board: BOARD, now: BEFORE }), 'club_not_alive');

  // AND THE BYE IS ROUND 1 ONLY. In the Division round the same clubs carry
  // no bye flag and are pickable - the board says who is alive, every round.
  const div = { round: 'division', firstPitch: '2026-10-04T18:00:00Z',
    clubs: CLUBS.filter((c) => [1, 5, 6, 7, 11, 12].includes(c.teamId)).map((c) => ({ ...c, bye: false })) };
  assert.equal(refuseReason({}, 'bat1', p(1, 5), { board: div, now: new Date('2026-10-03T00:00:00Z') }), null);
  assert.equal(refuseReason({}, 'bat1', p(1, 3), { board: div, now: new Date('2026-10-03T00:00:00Z') }), 'club_not_alive',
    'New York went out in the wild card');
});

test('MAX THREE FROM ONE CLUB, and a swap is not a fourth', () => {
  const three = { bat1: p(1, 7), bat2: p(2, 7), bat3: p(3, 7) };
  assert.equal(refuseReason(three, 'bat4', p(4, 7), { board: BOARD, now: BEFORE }), 'max_per_club');
  assert.equal(refuseReason(three, 'bat4', p(4, 1), { board: BOARD, now: BEFORE }), null);
  // Overwriting one of the three with another from the same club is legal.
  assert.equal(refuseReason(three, 'bat2', p(4, 7), { board: BOARD, now: BEFORE }), null);
  // AN ARM COUNTS TOWARD THE THREE - it is a player from that club.
  const armPlusTwo = { arm1: p(10, 7, 'arm'), bat1: p(1, 7), bat2: p(2, 7) };
  assert.equal(refuseReason(armPlusTwo, 'bat3', p(4, 7), { board: BOARD, now: BEFORE }), 'max_per_club');
  assert.deepEqual([...clubCounts(armPlusTwo)], [['7', 3]]);
});

test('THE LOCK IS THE ROUND\'S, not the slot\'s', () => {
  // October seals each pick at its own game; a Run roster is ONE bet on a
  // whole round and seals once, at the round's first pitch.
  assert.equal(isLocked(BOARD, BEFORE), false);
  assert.equal(isLocked(BOARD, AFTER), true, '`<=` at the boundary instant');
  assert.equal(refuseReason({}, 'bat1', p(1, 1), { board: BOARD, now: AFTER }), 'round_locked');
  // Every slot at once - there is no half-locked roster.
  for (const s of SLOTS) {
    assert.equal(refuseReason({}, s, p(1, 1, kindOf(s)), { board: BOARD, now: AFTER }), 'round_locked', s);
  }
});

test('THE BURN crosses rounds, and a player is not on the roster twice', () => {
  const used = new Map([['7', 'wild_card']]);
  assert.equal(refuseReason({}, 'bat1', p(7, 1), { board: BOARD, used, now: BEFORE }), 'used');
  assert.equal(refuseReason({}, 'bat1', p(8, 1), { board: BOARD, used, now: BEFORE }), null);
  // Compared as strings: a jsonb lineup gives back whatever it was written as.
  assert.equal(refuseReason({}, 'bat1', { playerId: 7, teamId: 1, kind: 'bat' },
    { board: BOARD, used, now: BEFORE }), 'used');
  assert.equal(refuseReason({ bat1: p(8, 1) }, 'bat2', p(8, 1), { board: BOARD, now: BEFORE }), 'already_on_roster');
});

test('AN UNSET ROSTER AT LOCK IS A DNF, and PARTIAL IS STILL A DNF', () => {
  const eight = Object.fromEntries(SLOTS.slice(0, 8).map((s, i) => [s, p(i + 1, 1, kindOf(s))]));
  // Before the lock it is simply open.
  assert.deepEqual(rosterState(eight, BOARD, BEFORE), { state: 'open', filled: 8 });
  // EIGHT OF NINE AT FIRST PITCH IS NOT "score the eight" - the roster is the
  // bet, and a short one was never a legal entry.
  assert.deepEqual(rosterState(eight, BOARD, AFTER), { state: DNF, filled: 8 });
  assert.equal(rosterState({}, BOARD, AFTER).state, DNF);
  const nine = { ...eight, [SLOTS[8]]: p(9, 1, kindOf(SLOTS[8])) };
  assert.deepEqual(rosterState(nine, BOARD, AFTER), { state: 'set', filled: 9 });
  assert.equal(progress(nine, BOARD, BEFORE).toGo, 0);
  assert.equal(progress(eight, BOARD, BEFORE).toGo, 1, 'the mock\'s "2 to go" counter');
  assert.equal(progress(eight, BOARD, BEFORE).arms, 2);
  assert.equal(progress(eight, BOARD, BEFORE).bats, 6);
});

test('FOUR PIPS: done, on, ahead - from the games, never from a date', () => {
  assert.deepEqual(roundPips('wild_card', []).map((r) => r.state), ['on', 'ahead', 'ahead', 'ahead']);
  assert.deepEqual(roundPips('division', ['wild_card']).map((r) => r.state), ['done', 'on', 'ahead', 'ahead']);
  assert.deepEqual(roundPips('world_series', ['wild_card', 'division', 'championship']).map((r) => r.state),
    ['done', 'done', 'done', 'on']);
  // The mock's own labels, and LCS is not "Championship Series" on a pip.
  assert.deepEqual(roundPips('wild_card', []).map((r) => r.label),
    ['Wild Card', 'Division', 'LCS', 'World Series']);
});

// --- THE ROUND LOCK ONCE A GAME HAS MOVED ----------------------------------
//
// The board's firstPitch is frozen at creation and never touched again, so
// before roundLockAt() a called-off opener sealed every roster in the round at
// a first pitch nobody threw. Both halves of the rule are pinned below.

// Round 1: three games, the earliest at 14:05 - which is what BOARD's frozen
// firstPitch is - then 18:05 and 22:05.
const G = (id, at, status = 'scheduled') => ({ matchId: String(id), kickoffAt: at, status });
const ROUND_GAMES = [
  G(1, '2026-09-29T14:05:00Z'),
  G(2, '2026-09-29T18:05:00Z'),
  G(3, '2026-09-29T22:05:00Z'),
];

test('roundLockAt with no games is the frozen first pitch, exactly as before', () => {
  assert.equal(roundLockAt(BOARD), Date.parse('2026-09-29T14:05:00Z'));
  assert.equal(roundLockAt(BOARD, {}), Date.parse('2026-09-29T14:05:00Z'));
  assert.equal(roundLockAt(BOARD, { games: [] }), Date.parse('2026-09-29T14:05:00Z'));
  // And with every game standing it is still the earliest of them, which is the
  // same instant - a round nothing has happened to does not move.
  assert.equal(roundLockAt(BOARD, { games: ROUND_GAMES }), Date.parse('2026-09-29T14:05:00Z'));
});

test('A POSTPONED GAME NEVER LOCKS THE ROUND EARLY', () => {
  // The opener - the very game the frozen lock was taken from - is called off.
  const games = [G(1, '2026-09-29T14:05:00Z', 'postponed'), ROUND_GAMES[1], ROUND_GAMES[2]];
  const lock = roundLockAt(BOARD, { games });
  assert.equal(lock, Date.parse('2026-09-29T18:05:00Z'),
    'the lock moves out to the next earliest game actually being played');

  // So at 14:05 - the frozen time - the round is STILL OPEN, and a roster can
  // still be set. Before this, every roster in the round sealed here.
  const at1405 = new Date('2026-09-29T14:05:00Z');
  assert.equal(isLocked(BOARD, at1405), true, 'the frozen reading alone locks it');
  assert.equal(isLocked(BOARD, at1405, { games }), false);
  assert.equal(refuseReason({}, 'bat1', p(1, 1), { board: BOARD, now: at1405, games }), null);
  // An unset roster is not a DNF yet either - the round has not begun.
  assert.equal(rosterState({}, BOARD, at1405, { games }).state, 'open');
  assert.equal(progress({}, BOARD, at1405, { games }).locked, false);

  // And it does lock at 18:05, when the round's first ball is actually thrown.
  const at1805 = new Date('2026-09-29T18:05:00Z');
  assert.equal(isLocked(BOARD, at1805, { games }), true);
  assert.equal(refuseReason({}, 'bat1', p(1, 1), { board: BOARD, now: at1805, games }), 'round_locked');
  assert.equal(rosterState({}, BOARD, at1805, { games }).state, DNF);
});

test('A POSTPONED GAME NEVER HOLDS THE ROUND OPEN PAST THE NEXT EARLIEST GAME', () => {
  // The opener is called off and REPLAYED THREE DAYS LATER. The live reading is
  // a MINIMUM, so Thursday cannot drag the lock to Thursday: the 18:05 game is
  // earlier and wins.
  const games = [
    G(1, '2026-10-02T20:00:00Z'),          // rescheduled, and now the LAST game
    ROUND_GAMES[1], ROUND_GAMES[2],
  ];
  assert.equal(roundLockAt(BOARD, { games }), Date.parse('2026-09-29T18:05:00Z'));
  const at1805 = new Date('2026-09-29T18:05:00Z');
  assert.equal(isLocked(BOARD, at1805, { games }), true,
    'rosters seal when the round\'s first ball is thrown, not when its last makeup is');

  // The same is true while it is still postponed AND a later game exists: the
  // round does not wait for the makeup to be scheduled.
  const pending = [G(1, '2026-09-29T14:05:00Z', 'postponed'), ROUND_GAMES[1], ROUND_GAMES[2]];
  assert.equal(roundLockAt(BOARD, { games: pending }), Date.parse('2026-09-29T18:05:00Z'));
});

test('a game moved EARLIER cannot steal editing time - the 067 law', () => {
  // The live earliest is BEFORE the frozen lock. The frozen time stands, because
  // a reschedule may grant time and never take it.
  const games = [G(1, '2026-09-29T11:00:00Z'), ROUND_GAMES[1]];
  assert.equal(roundLockAt(BOARD, { games }), Date.parse('2026-09-29T14:05:00Z'));
  assert.equal(isLocked(BOARD, new Date('2026-09-29T11:30:00Z'), { games }), false);
});

test('every game called off is not an early lock either', () => {
  // With nothing live to read, the frozen time is all there is - the round stays
  // as it was rather than locking on a reading built from an empty set.
  const games = ROUND_GAMES.map((g) => ({ ...g, status: 'postponed' }));
  assert.equal(roundLockAt(BOARD, { games }), Date.parse('2026-09-29T14:05:00Z'));
});

test('a final game still counts: the round it opened did begin', () => {
  // Game 1 was played, game 2 was then called off. The round locked at 14:05 and
  // must stay locked - a later postponement cannot reopen it.
  const games = [G(1, '2026-09-29T14:05:00Z', 'final'), G(2, '2026-09-29T18:05:00Z', 'postponed')];
  assert.equal(roundLockAt(BOARD, { games }), Date.parse('2026-09-29T14:05:00Z'));
  assert.equal(isLocked(BOARD, new Date('2026-09-29T16:00:00Z'), { games }), true);
});

test('a status map is honoured as well as the row\'s own status', () => {
  // The rows carry `status`; October's isPostponed shape is accepted too, so one
  // caller reading matches and another holding a map get the same answer.
  const games = ROUND_GAMES.map((g) => ({ ...g, status: null }));
  const statusBy = new Map([['1', 'postponed']]);
  assert.equal(roundLockAt(BOARD, { games, statusBy }), Date.parse('2026-09-29T18:05:00Z'));
});
