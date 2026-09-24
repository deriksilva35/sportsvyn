// lib/run/rules.test.mjs - the nine, and every refusal a roster can hit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOTS, ARM_SLOTS, BAT_SLOTS, ROSTER_SIZE, MAX_PER_CLUB, ROUNDS, DNF,
  kindOf, roundOf, weekOf, rosterState, refuseReason,
  clubCounts, progress, roundPips, clubLockAt, clubStarted, nextClubLock, allClubsStarted,
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

test('THE BURN crosses rounds, and a player is not on the roster twice', () => {
  const used = new Map([['7', 'wild_card']]);
  assert.equal(refuseReason({}, 'bat1', p(7, 1), { board: BOARD, used, now: BEFORE }), 'used');
  assert.equal(refuseReason({}, 'bat1', p(8, 1), { board: BOARD, used, now: BEFORE }), null);
  // Compared as strings: a jsonb lineup gives back whatever it was written as.
  assert.equal(refuseReason({}, 'bat1', { playerId: 7, teamId: 1, kind: 'bat' },
    { board: BOARD, used, now: BEFORE }), 'used');
  assert.equal(refuseReason({ bat1: p(8, 1) }, 'bat2', p(8, 1), { board: BOARD, now: BEFORE }), 'already_on_roster');
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

// --- THE LOCK IS THE CLUB'S (ruling of 24 Sep) -----------------------------
//
// It replaced the whole-round lock, preview and postseason alike. A Wild Card
// field is split across days; sealing all nine at the round's first pitch
// shut readers out of clubs that had not thrown a ball.

// TB-CHW at 14:05, NYY-BOS at 18:05, ATL-PHI at 22:05; CHC-SD tomorrow.
const G = (id, at, home, away, status = 'scheduled') =>
  ({ matchId: String(id), kickoffAt: at, status, homeTeamId: home, awayTeamId: away });
const GAMES = [
  G(1, '2026-09-29T14:05:00Z', 1, 2),
  G(2, '2026-09-29T18:05:00Z', 3, 4),
  G(3, '2026-09-29T22:05:00Z', 7, 8),
  G(4, '2026-09-30T18:05:00Z', 9, 10),
  // Game 2 of TB-CHW, tomorrow - it locks nobody new.
  G(5, '2026-09-30T14:05:00Z', 1, 2),
];
const AT_1500 = new Date('2026-09-29T15:00:00Z');   // TB-CHW under way, nobody else
const opts = { games: GAMES };

test('A CLUB LOCKS AT ITS OWN FIRST GAME OF THE ROUND - never the round', () => {
  assert.equal(clubLockAt(1, opts), Date.parse('2026-09-29T14:05:00Z'));
  assert.equal(clubLockAt(9, opts), Date.parse('2026-09-30T18:05:00Z'));
  assert.equal(clubStarted(1, AT_1500, opts), true);
  assert.equal(clubStarted(3, AT_1500, opts), false);
  assert.equal(clubStarted(1, new Date('2026-09-29T14:05:00Z'), opts), true, '`<=` at the boundary instant');
  // A game the feed calls live counts whatever its clock says.
  assert.equal(clubStarted(3, new Date('2026-09-29T10:00:00Z'), { games: [G(2, '2026-09-29T18:05:00Z', 3, 4, 'live')] }), true);
});

test('A CLUB THAT HAS STARTED IS REFUSED - by name, and only that club', () => {
  const o = { board: BOARD, now: AT_1500, games: GAMES };
  assert.equal(refuseReason({}, 'bat1', p(1, 1), o), 'game_started');
  assert.equal(refuseReason({}, 'bat1', p(2, 2), o), 'game_started');
  assert.equal(refuseReason({}, 'bat1', p(3, 3), o), null, 'NYY has not started - the round is not locked');
});

test('FILL FOUR SLOTS LATE, from clubs that have not started', () => {
  // 15:00: TB-CHW is under way. An empty nine can still take four from the
  // clubs ahead of their first pitch - the door says yes to every one.
  const o = { board: BOARD, now: AT_1500, games: GAMES };
  let lineup = {};
  for (const [slot, pl] of [['arm1', p(31, 3, 'arm')], ['bat1', p(32, 4)], ['bat2', p(33, 7)], ['bat3', p(34, 9)]]) {
    assert.equal(refuseReason(lineup, slot, pl, o), null, slot);
    lineup = { ...lineup, [slot]: pl };
  }
  assert.equal(progress(lineup, BOARD, AT_1500, opts).filled, 4);
  assert.equal(progress(lineup, BOARD, AT_1500, opts).locked, false, 'no LOCKED while a club is ahead');
});

test('A SEALED SLOT NEITHER SWAPS NOR CLEARS once its club has started', () => {
  const o = { board: BOARD, now: AT_1500, games: GAMES };
  const lineup = { bat1: p(11, 1), bat2: p(12, 3) };
  // bat1 holds a TB bat and TB is under way: replacing him is refused.
  assert.equal(refuseReason(lineup, 'bat1', p(13, 3), o), 'game_started');
  // bat2 holds a NYY bat, NYY is still ahead: he can be swapped.
  assert.equal(refuseReason(lineup, 'bat2', p(14, 4), o), null);
});

test('THE NEXT LOCK is the next first pitch of a club not yet started', () => {
  const n = nextClubLock(BOARD, AT_1500, opts);
  assert.equal(n.kickoffAt, '2026-09-29T18:05:00.000Z');
  assert.equal(n.label, 'BOS @ NYY');
  // After 22:05 only CHC-SD is ahead. TB-CHW's game 2 (tomorrow 14:05) is
  // EARLIER, but both its clubs started yesterday, so it locks nobody.
  const late = nextClubLock(BOARD, new Date('2026-09-29T23:00:00Z'), opts);
  assert.equal(late.kickoffAt, '2026-09-30T18:05:00.000Z');
  assert.equal(late.label, 'SD @ CHC');
  // Once every club has started there is no next lock, and only then LOCKED.
  const done = new Date('2026-09-30T19:00:00Z');
  assert.equal(nextClubLock(BOARD, done, opts), null);
  assert.equal(allClubsStarted(BOARD, done, opts), true);
  assert.equal(allClubsStarted(BOARD, AT_1500, opts), false);
});

test('A POSTPONED OPENER MOVES THE CLUB\'S LOCK OUT to its next game', () => {
  const games = [G(1, '2026-09-29T14:05:00Z', 1, 2, 'postponed'), G(5, '2026-09-30T14:05:00Z', 1, 2)];
  assert.equal(clubLockAt(1, { games }), Date.parse('2026-09-30T14:05:00Z'));
  assert.equal(clubStarted(1, AT_1500, { games }), false);
  assert.equal(refuseReason({}, 'bat1', p(1, 1), { board: BOARD, now: AT_1500, games }), null);
  // And a postponed game is never the next lock.
  assert.equal(nextClubLock({ clubs: [CLUBS[0], CLUBS[1]] }, AT_1500, { games }).kickoffAt, '2026-09-30T14:05:00.000Z');
});

test('DNF IS DECIDED AT THE ROUND\'S END, per slot', () => {
  const three = { arm1: p(1, 1, 'arm'), bat1: p(2, 3), bat2: p(3, 7) };
  // Before the end, a short nine is only open - some club may still be ahead.
  assert.deepEqual(rosterState(three), { state: 'open', filled: 3, dnfSlots: 0 });
  // SIX EMPTY AT ROUND END: those six are the DNF, and the three that were
  // filled still score (see settle.test.mjs) - the nine is 'short', not a DNF.
  assert.deepEqual(rosterState(three, { final: true }), { state: 'short', filled: 3, dnfSlots: 6 });
  // Nothing filled at all is a DNF round.
  assert.deepEqual(rosterState({}, { final: true }), { state: DNF, filled: 0, dnfSlots: 9 });
  const nine = Object.fromEntries(SLOTS.map((s, i) => [s, p(i + 1, 1, kindOf(s))]));
  assert.deepEqual(rosterState(nine, { final: true }), { state: 'set', filled: 9, dnfSlots: 0 });
  assert.equal(progress(three, BOARD, AT_1500).toGo, 6);
});
