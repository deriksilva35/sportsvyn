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

// ---------------------------------------------------------------------------
// seatLabels — the tracker's GRID view (real manager names as column headers)
// ---------------------------------------------------------------------------
const CFG4 = { teamsCount: 4, rosterSlots: { QB: 1, RB: 1 } };

test('seatLabels name the columns, but your own column still reads YOU', () => {
  const b = buildBoard(CFG4, [], { userTeamIndex: 1, currentOverall: 1, seatLabels: ['Dave', 'Sam', 'Kim', 'Ana'] });
  assert.deepEqual(b.columns.map((c) => c.label), ['Dave', 'YOU', 'Kim', 'Ana']);
  assert.deepEqual(b.columns.map((c) => c.isYou), [false, true, false, false]);
});

test('a blank or missing seat label falls back to the seat number', () => {
  const b = buildBoard(CFG4, [], { userTeamIndex: 0, currentOverall: 1, seatLabels: ['x', '', null, 'Ana'] });
  assert.deepEqual(b.columns.map((c) => c.label), ['YOU', '2', '3', 'Ana']);
});

test('omitting seatLabels leaves the sim board numbering untouched', () => {
  const withOut = buildBoard(CFG4, [], { userTeamIndex: 2, currentOverall: 1 });
  assert.deepEqual(withOut.columns.map((c) => c.label), ['1', '2', 'YOU', '4']);
  // and null behaves the same as omitted
  const withNull = buildBoard(CFG4, [], { userTeamIndex: 2, currentOverall: 1, seatLabels: null });
  assert.deepEqual(withNull.columns.map((c) => c.label), withOut.columns.map((c) => c.label));
});

test('snake geometry is unchanged by seat labels', () => {
  const plain = buildBoard(CFG4, [], { userTeamIndex: 0, currentOverall: 5 });
  const named = buildBoard(CFG4, [], { userTeamIndex: 0, currentOverall: 5, seatLabels: ['a', 'b', 'c', 'd'] });
  const overalls = (b) => b.rows.map((r) => r.cells.map((c) => c.overall));
  assert.deepEqual(overalls(named), overalls(plain));
  // round 1 runs left->right, round 2 right->left
  assert.deepEqual(overalls(plain)[0], [1, 2, 3, 4]);
  assert.deepEqual(overalls(plain)[1], [8, 7, 6, 5]);
});

// ---- Stage 5: unmade keepers own their cells ------------------------------
test('an unmade keeper renders in its cell - never empty - and yields to the pick that commits it', () => {
  // 4 teams: overall 10 is round 3 (L->R), column 1. Overall 7 is round 2 (R->L), column 1.
  const keepers = [
    { overall: 10, name: 'Brock Bowers', position: 'TE', slotPos: 'TE', teamSlot: 2 },
    { overall: 7, name: 'Joe Burrow', position: 'QB', slotPos: 'QB', teamSlot: 2 },
  ];
  const b = buildBoard(config, [], { currentOverall: 1, keepers });
  const c10 = b.rows[2].cells[1];
  assert.equal(c10.overall, 10);
  assert.equal(c10.keeper.name, 'Brock Bowers');
  assert.equal(c10.pick, null);
  assert.equal(c10.empty, false);
  assert.equal(b.rows[1].cells[1].keeper.name, 'Joe Burrow');
  // Every keeper cell is non-empty while the config holds it; every other non-clock cell still is.
  const keeperOveralls = new Set(keepers.map((k) => k.overall));
  for (const row of b.rows) for (const c of row.cells) {
    if (keeperOveralls.has(c.overall)) assert.equal(c.empty, false, `keeper cell ${c.overall} rendered empty`);
    else if (c.overall !== 1) assert.equal(c.empty, true);
  }
  // The commit: a pick at overall 10 flagged isKeeper replaces the shelf entry in the cell.
  const after = buildBoard(config, [{ overallPick: 10, position: 'TE', playerName: 'Brock Bowers', isKeeper: true }], { currentOverall: 11, keepers });
  assert.equal(after.rows[2].cells[1].pick.isKeeper, true);
  assert.equal(after.rows[2].cells[1].keeper, null);
  // No keepers passed: the board is exactly what it was.
  assert.deepEqual(buildBoard(config, [], { currentOverall: 1 }).rows[2].cells[1], { ...c10, keeper: null, empty: true });
});

// ---- Seat = franchise (ruling 2 Sep): the keeper board never re-derives -----
test('a keeper cell never varies by which seat the reader plays; only the YOU column and mine flags move', () => {
  const keepers = [
    { overall: 10, name: 'Brock Bowers', position: 'TE', slotPos: 'TE', teamSlot: 2 },
    { overall: 7, name: 'Joe Burrow', position: 'QB', slotPos: 'QB', teamSlot: 2 },
    { overall: 4, name: 'Denzel Boston', position: 'WR', slotPos: 'WR', teamSlot: 4 },
  ];
  const cellsOf = (b) => b.rows.flatMap((r) => r.cells).map((c) => ({ overall: c.overall, keeper: c.keeper?.name ?? null }));
  const base = cellsOf(buildBoard(config, [], { userTeamIndex: 1, currentOverall: 1, keepers }));
  for (const seat of [0, 1, 2, 3]) {
    const b = buildBoard(config, [], { userTeamIndex: seat, currentOverall: 1, keepers });
    assert.deepEqual(cellsOf(b), base, `keeper cells identical from seat ${seat + 1}`);
    assert.equal(b.columns.findIndex((c) => c.label === 'YOU'), seat, 'the YOU column is the franchise chosen');
  }
});
