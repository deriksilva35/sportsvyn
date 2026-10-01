// lib/six/rules.test.mjs - every rule of Tonight's Six, pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLOTS, eligible, slotsFor, maxPerTeam, refuseReason, clearReason, lockedSlots, nightState,
  nextLock, cardProgress, targetSlot, gameLocked, DNF,
} from './rules.js';

// A three-game night, six teams: tips 23:00Z, 00:30Z, 03:00Z.
const BOARD = [
  { match_id: 1, kickoff_at: '2026-10-21T23:00:00Z', home_team_id: 11, away_team_id: 12, home: { abbr: 'ORL' }, away: { abbr: 'DAL' } },
  { match_id: 2, kickoff_at: '2026-10-22T00:30:00Z', home_team_id: 21, away_team_id: 22, home: { abbr: 'HOU' }, away: { abbr: 'GSW' } },
  { match_id: 3, kickoff_at: '2026-10-22T03:00:00Z', home_team_id: 31, away_team_id: 32, home: { abbr: 'DEN' }, away: { abbr: 'LAL' } },
];
const BEFORE = new Date('2026-10-21T20:00:00Z');
const AFTER_FIRST = new Date('2026-10-21T23:30:00Z');
const AFTER_ALL = new Date('2026-10-22T03:30:00Z');
const P = (id, matchId, teamId, position) => ({ playerId: String(id), matchId, teamId, position });

test('the six slots, and eligibility from the provider position (ruling thu-17)', () => {
  assert.deepEqual(SLOTS, ['g1', 'g2', 'f1', 'f2', 'c', 'util']);
  const ok = (pos) => SLOTS.filter((s) => eligible(s, pos));
  assert.deepEqual(ok('G'), ['g1', 'g2', 'util']);
  assert.deepEqual(ok('G-F'), ['g1', 'g2', 'f1', 'f2', 'util']);
  // VERBATIM: the ruling lists F-G under G and NOT under F (G-F is under both).
  // Flagged to Derik as a likely slip; the table is not "fixed" here.
  assert.deepEqual(ok('F-G'), ['g1', 'g2', 'util']);
  assert.deepEqual(ok('F'), ['f1', 'f2', 'util']);
  assert.deepEqual(ok('F-C'), ['f1', 'f2', 'c', 'util']);
  assert.deepEqual(ok('C-F'), ['f1', 'f2', 'c', 'util']);
  assert.deepEqual(ok('C'), ['c', 'util']);
  assert.deepEqual(ok(''), ['util'], 'no listed position: UTIL only');
  assert.deepEqual(slotsFor(' g '), ['g1', 'g2', 'util'], 'trimmed and case-folded');
});

test('THE CAP SCALES, THE CARD DOES NOT: max(2, ceil(6 / teams))', () => {
  assert.equal(maxPerTeam(BOARD.slice(0, 1)), 3, 'one game, two teams: 3+3 makes six');
  assert.equal(maxPerTeam(BOARD.slice(0, 2)), 2, 'two games: 2+2+2');
  assert.equal(maxPerTeam(BOARD), 2);
  assert.equal(maxPerTeam([]), 2);
  // A void game's teams cannot be picked, so they do not count.
  const statusBy = new Map([['2', 'postponed']]);
  assert.equal(maxPerTeam(BOARD.slice(0, 2), { statusBy }), 3, 'two games, one postponed: a one-game night');
});

test('refuseReason: position, cap, duplicate, Out, void, bad team', () => {
  const lineup = { g1: P(1, 1, 11, 'G'), g2: P(2, 1, 11, 'G') };
  const o = { board: BOARD, now: BEFORE };
  assert.equal(refuseReason(lineup, 'c', P(3, 1, 11, 'C'), o), 'max_from_team', 'a third Magic');
  assert.equal(refuseReason(lineup, 'g2', P(3, 1, 11, 'G'), o), null, 'overwriting a Magic slot with a Magic is fine');
  assert.equal(refuseReason(lineup, 'c', P(3, 1, 12, 'C'), o), null, 'a Maverick is fine');
  assert.equal(refuseReason(lineup, 'c', P(3, 1, 12, 'G'), o), 'wrong_position');
  assert.equal(refuseReason(lineup, 'util', P(1, 1, 11, 'G'), o), 'already_on_card');
  assert.equal(refuseReason(lineup, 'c', P(3, 1, 99, 'C'), o), 'bad_player', 'the team must be one of the game\'s two');
  assert.equal(refuseReason(lineup, 'c', P(3, 9, 12, 'C'), o), 'not_tonight');
  assert.equal(refuseReason(lineup, 'xx', P(3, 1, 12, 'C'), o), 'bad_slot');
  assert.equal(refuseReason(lineup, 'c', P(3, 1, 12, 'C'), { ...o, outIds: new Set(['3']) }), 'player_out');
  assert.equal(refuseReason(lineup, 'c', P(3, 1, 12, 'C'), { ...o, statusBy: new Map([['1', 'postponed']]) }), 'not_played');
  // On a one-game night the cap is 3 - the third Magic is legal.
  assert.equal(refuseReason(lineup, 'c', P(3, 1, 11, 'C'), { board: BOARD.slice(0, 1), now: BEFORE }), null);
});

test('THE LOCK READS THE CURRENT TIP, not the snapshot', () => {
  const lineup = { g1: P(1, 1, 11, 'G') };
  // Snapshot says 23:00Z; the row now says 01:00Z (moved later): still open at 23:30Z.
  const later = { kickoffBy: new Map([['1', '2026-10-22T01:00:00Z']]) };
  assert.equal(refuseReason(lineup, 'c', P(3, 1, 12, 'C'), { board: BOARD, now: AFTER_FIRST, ...later }), null);
  assert.equal(lockedSlots(lineup, BOARD, AFTER_FIRST, later).has('g1'), false);
  // And moved EARLIER: locked before the snapshot's tip.
  const earlier = { kickoffBy: new Map([['1', '2026-10-21T19:00:00Z']]) };
  assert.equal(refuseReason({}, 'c', P(3, 1, 12, 'C'), { board: BOARD, now: BEFORE, ...earlier }), 'game_started');
  // Left 'scheduled' early (tipped before its listed time): locked.
  assert.equal(gameLocked(BOARD[0], BEFORE, { statusBy: new Map([['1', 'live']]) }), true);
  // `<=` at the boundary instant.
  assert.equal(gameLocked(BOARD[0], new Date('2026-10-21T23:00:00Z')), true);
  assert.equal(gameLocked(BOARD[0], new Date('2026-10-21T22:59:59Z')), false);
});

test('a sealed slot cannot be overwritten or cleared; an open one can, before its tip', () => {
  const lineup = { g1: P(1, 1, 11, 'G'), g2: P(2, 2, 21, 'G') };
  assert.equal(refuseReason(lineup, 'g1', P(5, 3, 31, 'G'), { board: BOARD, now: AFTER_FIRST }), 'slot_locked');
  assert.equal(refuseReason(lineup, 'g2', P(5, 3, 31, 'G'), { board: BOARD, now: AFTER_FIRST }), null, 'pre-tip swap');
  assert.equal(refuseReason(lineup, 'c', P(6, 1, 12, 'C'), { board: BOARD, now: AFTER_FIRST }), 'game_started');
  assert.equal(clearReason(lineup, 'g1', { board: BOARD, now: AFTER_FIRST }), 'slot_locked');
  assert.equal(clearReason(lineup, 'g2', { board: BOARD, now: AFTER_FIRST }), null);
});

test('nightState: DNF only once the LAST playable tip has passed with a slot empty', () => {
  const five = { g1: P(1, 1, 11, 'G'), g2: P(2, 1, 12, 'G'), f1: P(3, 2, 21, 'F'), f2: P(4, 2, 22, 'F'), c: P(5, 3, 31, 'C') };
  assert.equal(nightState(five, BOARD, AFTER_FIRST).state, 'open');
  assert.equal(nightState(five, BOARD, AFTER_ALL).state, DNF);
  assert.equal(nightState({ ...five, util: P(6, 3, 32, 'G') }, BOARD, AFTER_ALL).state, 'complete');
  // A postponed last game does not hold the night open - the 00:30 game is the last chance.
  const statusBy = new Map([['3', 'postponed']]);
  assert.equal(nightState(five, BOARD, new Date('2026-10-22T01:00:00Z'), { statusBy }).state, DNF);
});

test('nextLock, progress pips, and which slot a tap fills', () => {
  assert.equal(nextLock(BOARD, BEFORE).match_id, 1);
  assert.equal(nextLock(BOARD, AFTER_FIRST).match_id, 2);
  assert.equal(nextLock(BOARD, AFTER_ALL), null);
  const lineup = { g1: P(1, 1, 11, 'G'), f1: P(3, 2, 21, 'F') };
  assert.deepEqual(cardProgress(lineup, BOARD, AFTER_FIRST).pips, ['locked', 'open', 'picked', 'open', 'open', 'open']);
  assert.equal(targetSlot(lineup, 'G'), 'g2');
  assert.equal(targetSlot({ ...lineup, g2: P(2, 1, 12, 'G') }, 'G'), 'util', 'specific slots first, then UTIL');
  assert.equal(targetSlot(lineup, 'F-C'), 'f2');
  assert.equal(targetSlot(lineup, 'F-C', { prefer: 'c' }), 'c', 'a tapped slot wins when it fits');
  assert.equal(targetSlot(lineup, 'G', { prefer: 'c' }), 'g2', 'and is ignored when it does not');
  const full = { g1: 1, g2: 1, f1: 1, f2: 1, c: 1, util: 1 };
  for (const k of Object.keys(full)) full[k] = P(k, 1, 11, 'G');
  assert.equal(targetSlot(full, 'C'), null);
});
