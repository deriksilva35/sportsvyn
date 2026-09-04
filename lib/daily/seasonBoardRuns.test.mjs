// lib/daily/seasonBoardRuns.test.mjs - buildRosterFromPicks is PURE and gets
// its own tests here; submitRun's DB path is proved by scripts/daily-board-
// run-sentinel.mjs against a real DEV board (a sentinel user, never a real
// one - see that script's own header).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRosterFromPicks, regradeStoredRun } from './seasonBoardRuns.js';
import { initBoardPlay, commitPick } from './seasonBoardPlay.js';
import { gradeBoard } from './seasonBoardGrade.js';
import { solveBoard } from './assignmentSolver.js';

const SLOTS3 = ['QB', 'RB', 'FLEX'];

function board() {
  return {
    board: [
      { key: 'T1', card: [{ position: 'QB', name: 'Q One', points: 20, meta: '' }] },
      { key: 'T2', card: [{ position: 'RB', name: 'R One', points: 15, meta: '' }] },
      { key: 'T3', card: [{ position: 'WR', name: 'W One', points: 12, meta: '' }] },
    ],
  };
}

test('a fully legal picks[] builds a roster with no gaps', () => {
  const picks = [
    { slotIndex: 0, teamKey: 'T1', playerName: 'Q One' },
    { slotIndex: 1, teamKey: 'T2', playerName: 'R One' },
    { slotIndex: 2, teamKey: 'T3', playerName: 'W One' }, // WR is FLEX-eligible
  ];
  const r = buildRosterFromPicks(board(), picks, SLOTS3);
  assert.equal(r.ok, true);
  assert.equal(r.roster[2].pick.player.name, 'W One');
  assert.equal(r.used.size, 3);
});

test('refuses a team not on this board - a client cannot invent a team', () => {
  const picks = [
    { slotIndex: 0, teamKey: 'GHOST', playerName: 'Nobody' },
    { slotIndex: 1, teamKey: 'T2', playerName: 'R One' },
    { slotIndex: 2, teamKey: 'T3', playerName: 'W One' },
  ];
  const r = buildRosterFromPicks(board(), picks, SLOTS3);
  assert.equal(r.ok, false);
  assert.match(r.reason, /not on this board/);
});

test('refuses a player not on the named team\'s card', () => {
  const picks = [
    { slotIndex: 0, teamKey: 'T1', playerName: 'W One' }, // W One is on T3, not T1
    { slotIndex: 1, teamKey: 'T2', playerName: 'R One' },
    { slotIndex: 2, teamKey: 'T3', playerName: 'W One' },
  ];
  const r = buildRosterFromPicks(board(), picks, SLOTS3);
  assert.equal(r.ok, false);
  assert.match(r.reason, /is not on/);
});

test('refuses an ineligible slot - a QB cannot fill RB', () => {
  const picks = [
    { slotIndex: 0, teamKey: 'T1', playerName: 'Q One' },
    { slotIndex: 1, teamKey: 'T1', playerName: 'Q One' }, // same team AND wrong position
    { slotIndex: 2, teamKey: 'T3', playerName: 'W One' },
  ];
  const r = buildRosterFromPicks(board(), picks, SLOTS3);
  assert.equal(r.ok, false);
});

test('refuses the same team used twice', () => {
  const picks = [
    { slotIndex: 0, teamKey: 'T1', playerName: 'Q One' },
    { slotIndex: 1, teamKey: 'T2', playerName: 'R One' },
    { slotIndex: 2, teamKey: 'T2', playerName: 'R One' },
  ];
  const r = buildRosterFromPicks(board(), picks, SLOTS3);
  assert.equal(r.ok, false);
  assert.match(r.reason, /used more than once/);
});

test('refuses a short picks array - every slot must be filled', () => {
  const picks = [{ slotIndex: 0, teamKey: 'T1', playerName: 'Q One' }];
  const r = buildRosterFromPicks(board(), picks, SLOTS3);
  assert.equal(r.ok, false);
});

// -----------------------------------------------------------------------
// A3: a stored run reloads to the SAME grade a live play-through produced.
// picks[] (the wire shape) is derived straight off the live play's own
// roster, then run back through the exact rebuild path a page reload uses
// (buildRosterFromPicks + gradeFromOptimum, via regradeStoredRun) against a
// board-row shape matching what ensureBoardForDate actually stores
// (board.board, ceiling, best_roster) - not a hand-shortened stand-in.
// -----------------------------------------------------------------------
test('same picks in, same rows out as the original grade', () => {
  const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'];
  const teams = [
    { key: 'T1', abbr: 'T1', card: [{ position: 'QB', name: 'Lamar Jackson', points: 30, meta: '' }] },
    { key: 'T2', abbr: 'T2', card: [{ position: 'RB', name: 'Christian McCaffrey', points: 25, meta: '' }] },
    { key: 'T3', abbr: 'T3', card: [{ position: 'RB', name: 'Saquon Barkley', points: 20, meta: '' }] },
    { key: 'T4', abbr: 'T4', card: [{ position: 'WR', name: 'Tyreek Hill', points: 18, meta: '' }] },
    { key: 'T5', abbr: 'T5', card: [{ position: 'WR', name: "Ja'Marr Chase", points: 17, meta: '' }] },
    { key: 'T6', abbr: 'T6', card: [{ position: 'TE', name: 'Travis Kelce', points: 15, meta: '' }] },
    { key: 'T7', abbr: 'T7', card: [{ position: 'RB', name: 'Derrick Henry', points: 12, meta: '' }] },
    { key: 'T8', abbr: 'T8', card: [{ position: 'PK', name: 'Justin Tucker', points: 10, meta: '' }] },
  ];

  let play = initBoardPlay(teams, SLOTS);
  play = commitPick(play, teams[0], teams[0].card[0], 0); // Lamar -> QB
  play = commitPick(play, teams[1], teams[1].card[0], 1); // McCaffrey -> RB
  play = commitPick(play, teams[2], teams[2].card[0], 2); // Barkley -> RB
  play = commitPick(play, teams[3], teams[3].card[0], 3); // Hill -> WR
  play = commitPick(play, teams[4], teams[4].card[0], 4); // Chase -> WR
  play = commitPick(play, teams[5], teams[5].card[0], 5); // Kelce -> FLEX
  play = commitPick(play, teams[6], teams[6].card[0], 6); // Henry -> FLEX
  play = commitPick(play, teams[7], teams[7].card[0], 7); // Tucker -> K

  const originalGrade = gradeBoard(play, teams, SLOTS);
  assert.equal(originalGrade.ok, true);

  const optimum = solveBoard(teams, SLOTS);
  const boardRow = { board: teams, ceiling: optimum.total, best_roster: optimum.bySlot };
  const picks = play.roster.map((r, slotIndex) => ({ slotIndex, teamKey: r.pick.teamKey, playerName: r.pick.player.name }));

  const rebuilt = regradeStoredRun(boardRow, picks, SLOTS);
  assert.equal(rebuilt.ok, true);

  assert.deepEqual(
    rebuilt.grade.rows.map((r) => ({ hit: r.hit, ahead: r.ahead, moved: r.moved, you: r.you.name, best: r.best.name })),
    originalGrade.rows.map((r) => ({ hit: r.hit, ahead: r.ahead, moved: r.moved, you: r.you.name, best: r.best.name })),
  );
  assert.equal(rebuilt.grade.mine, originalGrade.mine);
  assert.equal(rebuilt.grade.perfect, originalGrade.perfect);
  assert.equal(rebuilt.grade.pct, originalGrade.pct);
});
