// Tonight's Six, ruling sat-5 - PURE:
//   S1  a slot on a VOID game never locks: it can be swapped or cleared, and a
//       live / final game still locks as before;
//   S2  the rules copy says the bonus stack exactly;
//   S3  the re-grade's comparison and its box re-pull cadence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameLocked, lockedSlots, refuseReason, clearReason, nightState, cardProgress, VOID_STATUSES } from './rules.js';
import { RULES_LINE, rawPoints } from '../nba/fantasyPoints.js';
import { regradeDiff, boxRecheckDue, gradeNight, REGRADE_DAYS, BOX_RECHECK_H } from './settle.js';

const BOARD = [
  { match_id: 1, kickoff_at: '2026-10-21T23:00:00Z', home_team_id: 11, away_team_id: 12, home: { abbr: 'ORL' }, away: { abbr: 'DAL' } },
  { match_id: 2, kickoff_at: '2026-10-22T00:30:00Z', home_team_id: 21, away_team_id: 22, home: { abbr: 'HOU' }, away: { abbr: 'GSW' } },
];
const P = (id, matchId, teamId, position) => ({ playerId: String(id), matchId, teamId, position });
const AFTER_ALL = new Date('2026-10-22T04:00:00Z');
const BEFORE = new Date('2026-10-21T20:00:00Z');

test('S1: a VOID game never locks - before, at or long after its listed tip', () => {
  for (const s of VOID_STATUSES) {
    const statusBy = new Map([['1', s]]);
    assert.equal(gameLocked(BOARD[0], BEFORE, { statusBy }), false, s);
    assert.equal(gameLocked(BOARD[0], AFTER_ALL, { statusBy }), false, `${s}, after the tip`);
  }
  // a live or final game still locks, as before
  assert.equal(gameLocked(BOARD[0], BEFORE, { statusBy: new Map([['1', 'live']]) }), true);
  assert.equal(gameLocked(BOARD[0], AFTER_ALL, { statusBy: new Map([['1', 'final']]) }), true);
  assert.equal(gameLocked(BOARD[0], AFTER_ALL), true, 'scheduled and past its tip');
});

test('S1: a slot on a void game can be cleared and swapped; nothing new can be picked from it', () => {
  const statusBy = new Map([['1', 'postponed']]);
  const lineup = { g1: P(1, 1, 11, 'G'), f1: P(2, 2, 21, 'F') };
  const at = new Date('2026-10-22T01:00:00Z');                  // both listed tips passed
  const o = { board: BOARD, now: at, statusBy };
  assert.deepEqual([...lockedSlots(lineup, BOARD, at, { statusBy })], ['f1'], 'the HOU slot seals; the void one does not');
  assert.equal(clearReason(lineup, 'g1', o), null, 'cleared');
  assert.equal(clearReason(lineup, 'f1', o), 'slot_locked');
  assert.equal(refuseReason(lineup, 'g1', P(3, 1, 12, 'G'), o), 'not_played', 'nothing comes FROM the void game');
  assert.deepEqual(cardProgress(lineup, BOARD, at, { statusBy }).pips, ['picked', 'open', 'locked', 'open', 'open', 'open']);
  // swap into it from a game that has not tipped (a later one tonight)
  const board3 = [...BOARD, { match_id: 3, kickoff_at: '2026-10-22T03:00:00Z', home_team_id: 31, away_team_id: 32 }];
  assert.equal(refuseReason(lineup, 'g1', P(4, 3, 31, 'G'), { board: board3, now: at, statusBy }), null);
  // the night state still ignores void games: every playable game tipped -> closed
  assert.equal(nightState(lineup, BOARD, at, { statusBy }).state, 'closed');
});

test('S2: the copy says the stack, exactly - and the arithmetic pays it', () => {
  assert.ok(RULES_LINE.endsWith('DD +1.5, TD +3 (stack: +4.5)'));
  const td = { pts: 10, reb: 10, ast: 10 };
  assert.equal(rawPoints(td) - (10 + 12.5 + 15), 4.5);
});

test('S3: the comparison - only rows that differ, the perfect six by score and players', () => {
  const stored = [
    { id: 1, score: '40.5', six: { state: 'complete', filled: 6, dnp: 0, rank: 1, of: 2, regraded_at: 'x' } },
    { id: 2, score: '30', six: { state: 'complete', filled: 6, dnp: 0, rank: 2, of: 2 } },
  ];
  const same = { rows: [
    { id: 1, score: 40.5, six: { state: 'complete', filled: 6, dnp: 0, rank: 1, of: 2 } },
    { id: 2, score: 30, six: { state: 'complete', filled: 6, dnp: 0, rank: 2, of: 2 } },
  ], perfect: { score: 99, players: [{ playerId: '5', points: 50, slot: 'g1' }] } };
  const perfect = { score: 99, players: [{ playerId: '5', points: 50, slot: 'g1', name: 'x' }], cap: 2 };
  assert.deepEqual(regradeDiff(stored, same, perfect), { entries: [], perfect: false }, 'unchanged: nothing to write');
  const moved = { ...same, rows: [{ ...same.rows[0], score: 29, six: { ...same.rows[0].six, rank: 2 } }, { ...same.rows[1], six: { ...same.rows[1].six, rank: 1 } }] };
  assert.deepEqual(regradeDiff(stored, moved, perfect).entries.map((r) => r.id), [1, 2], 'a rank moved by another card\'s correction is a change too');
  assert.equal(regradeDiff(stored, { ...same, perfect: { score: 98, players: perfect.players } }, perfect).perfect, true);
});

test('S3: the window and the box re-pull cadence', () => {
  assert.equal(REGRADE_DAYS, 7);
  assert.equal(BOX_RECHECK_H, 24);
  const now = new Date('2026-10-23T12:00:00Z');
  assert.equal(boxRecheckDue({}, now), true, 'never re-pulled');
  assert.equal(boxRecheckDue(null, now), true);
  assert.equal(boxRecheckDue({ box_recheck_at: '2026-10-23T00:00:00Z' }, now), false, '12h ago');
  assert.equal(boxRecheckDue({ box_recheck_at: '2026-10-22T12:00:00Z' }, now), true, '24h ago');
});

test('S3: gradeNight is the settle\'s arithmetic - ranks shared, an empty card unranked', () => {
  const byId = new Map([['1', { status: 'final', kickoff_at: BOARD[0].kickoff_at }], ['2', { status: 'final', kickoff_at: BOARD[1].kickoff_at }]]);
  const statBy = new Map([
    ['1:1', { bdl_player_id: '1', team_id: 11, player_name: 'A', position: 'G', seconds: 1800, dnp: false, pts: 20 }],
    ['2:2', { bdl_player_id: '2', team_id: 21, player_name: 'B', position: 'F', seconds: 1800, dnp: false, pts: 10 }],
  ]);
  const entries = [
    { id: 1, user_id: 1, lineup: { g1: P(1, 1, 11, 'G') } },
    { id: 2, user_id: 2, lineup: { f1: P(2, 2, 21, 'F') } },
    { id: 3, user_id: 3, lineup: {} },
  ];
  const g = gradeNight(BOARD, entries, byId, statBy, AFTER_ALL);
  assert.deepEqual(g.rows.map((r) => [r.id, r.score, r.six.rank]), [[1, 20, 1], [2, 10, 2], [3, null, null]]);
  assert.equal(g.ranked, 2);
});
