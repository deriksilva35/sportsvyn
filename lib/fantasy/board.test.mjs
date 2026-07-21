// lib/fantasy/board.test.mjs — snake-board grid derivation. Snake geometry is
// hand-verified: round 1 L->R, round 2 R->L, etc.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, boardName } from './board.js';

const config = { teamsCount: 4, rosterSlots: { QB: 1, RB: 1, WR: 1 } }; // 3 rounds, 4 teams

test('grid is teams columns x rounds rows', () => {
  const b = buildBoard(config, [], {});
  assert.equal(b.teams, 4);
  assert.equal(b.rounds, 3);
  assert.equal(b.columns.length, 4);
  assert.equal(b.rows.length, 3);
});

test('snake order: round 1 L->R (overall 1..4), round 2 R->L (5..8), round 3 L->R (9..12)', () => {
  const b = buildBoard(config, [], {});
  // round 1: column teamIndex 0..3 -> overall 1..4
  assert.deepEqual(b.rows[0].cells.map((c) => c.overall), [1, 2, 3, 4]);
  // round 2 reverses: column 0 gets overall 8, column 3 gets overall 5
  assert.deepEqual(b.rows[1].cells.map((c) => c.overall), [8, 7, 6, 5]);
  // round 3 forward again: column 0 -> 9 ... column 3 -> 12
  assert.deepEqual(b.rows[2].cells.map((c) => c.overall), [9, 10, 11, 12]);
});

test('each team owns exactly one cell per round (column is fixed)', () => {
  const b = buildBoard(config, [], {});
  for (const row of b.rows) {
    assert.deepEqual(row.cells.map((c) => c.teamIndex), [0, 1, 2, 3]);
  }
});

test('YOU column + mine flag key off userTeamIndex', () => {
  const b = buildBoard(config, [], { userTeamIndex: 2 });
  assert.equal(b.columns[2].isYou, true);
  assert.equal(b.columns[2].label, 'YOU');
  assert.equal(b.columns[0].label, '1');
  for (const row of b.rows) assert.equal(row.cells[2].mine, true);
});

test('a placed pick lands in its snake cell; on-the-clock cell is flagged not empty', () => {
  const picks = [
    { overallPick: 1, position: 'RB', playerName: 'Bijan Robinson' },
    { overallPick: 5, position: 'WR', playerName: 'Puka Nacua' }, // round 2, column 3
  ];
  const b = buildBoard(config, picks, { currentOverall: 6 });
  assert.equal(b.rows[0].cells[0].pick.playerName, 'Bijan Robinson'); // overall 1 -> r1c0
  assert.equal(b.rows[1].cells[3].pick.playerName, 'Puka Nacua'); // overall 5 -> r2c3
  const clockCell = b.rows[1].cells.find((c) => c.overall === 6);
  assert.equal(clockCell.onClock, true);
  assert.equal(clockCell.empty, false);
  // an untouched, non-clock cell is empty
  assert.equal(b.rows[2].cells[0].empty, true);
});

test('board reads config in DB shape too (teams_count / roster_slots)', () => {
  const b = buildBoard({ teams_count: 4, roster_slots: { QB: 1, RB: 1 } }, [], {});
  assert.equal(b.teams, 4);
  assert.equal(b.rounds, 2);
});

test('boardName takes the last name, truncated', () => {
  assert.equal(boardName('Amon-Ra St. Brown'), 'Brown');
  assert.equal(boardName('Christian McCaffrey'), 'McCaffre');
  assert.equal(boardName(''), '');
});
