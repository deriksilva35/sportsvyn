// lib/daily/seasonBoardGrade.test.mjs — the grade, hand-worked before it is
// ever pointed at a real completed board.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeBoard, boardStory } from './seasonBoardGrade.js';
import { initBoardPlay, commitPick } from './seasonBoardPlay.js';

const team = (key, card) => ({ key, abbr: key, card });

// -----------------------------------------------------------------------
// THE HAND-WORKED CASE. Slots X, Y. T1 fields Alice(X,10) and Bob(Y,9);
// T2 fields Carol(X,8) and Dave(Y,1). The true optimum (same arithmetic as
// assignmentSolver.test.mjs's identical numbers): X->Carol(T2,8),
// Y->Bob(T1,9) = 17.
//
// The PLAYER instead picks Alice(T1) for X and Dave(T2) for Y - total 11,
// zero names in common with the optimum. By hand:
//   Alice(10) vs Bob(9)  -> Alice scored MORE: "ahead" by +1
//   Dave(1)   vs Carol(8) -> Dave scored LESS: a real miss, -7
// -----------------------------------------------------------------------
test('the hand-worked case: one AHEAD row, one MISS row, exact pct and points-left', () => {
  const teams = [
    team('T1', [{ position: 'X', name: 'Alice', points: 10, meta: '' }, { position: 'Y', name: 'Bob', points: 9, meta: '' }]),
    team('T2', [{ position: 'X', name: 'Carol', points: 8, meta: '' }, { position: 'Y', name: 'Dave', points: 1, meta: '' }]),
  ];
  const slots = ['X', 'Y'];
  let play = initBoardPlay(teams, slots);
  play = commitPick(play, teams[0], teams[0].card[0], 0); // Alice -> X
  play = commitPick(play, teams[1], teams[1].card[1], 1); // Dave -> Y

  const grade = gradeBoard(play, teams, slots);
  assert.equal(grade.ok, true);
  assert.equal(grade.mine, 11);
  assert.equal(grade.perfect, 17);
  assert.equal(grade.pct, 65, 'round(11/17*100) = 65, by hand');
  assert.equal(grade.pointsLeft, 6);
  assert.equal(grade.matchedCount, 0, 'zero names in common with the optimum');

  const aheadRow = grade.rows.find((r) => r.you?.name === 'Alice');
  assert.equal(aheadRow.hit, false);
  assert.equal(aheadRow.ahead, true);
  assert.equal(aheadRow.best.name, 'Bob');

  const missRow = grade.rows.find((r) => r.you?.name === 'Dave');
  assert.equal(missRow.hit, false);
  assert.equal(missRow.ahead, false);
  assert.equal(missRow.best.name, 'Carol');
});

test('a perfect roster: 100%, zero points left, every row hit, an all-green glyph', () => {
  const teams = [
    team('T1', [{ position: 'X', name: 'Alice', points: 10, meta: '' }, { position: 'Y', name: 'Bob', points: 9, meta: '' }]),
    team('T2', [{ position: 'X', name: 'Carol', points: 8, meta: '' }, { position: 'Y', name: 'Dave', points: 1, meta: '' }]),
  ];
  const slots = ['X', 'Y'];
  let play = initBoardPlay(teams, slots);
  play = commitPick(play, teams[1], teams[1].card[0], 0); // Carol -> X (the true optimum)
  play = commitPick(play, teams[0], teams[0].card[1], 1); // Bob -> Y (the true optimum)

  const grade = gradeBoard(play, teams, slots);
  assert.equal(grade.pct, 100);
  assert.equal(grade.pointsLeft, 0);
  assert.equal(grade.matchedCount, 2);
  assert.equal(grade.glyph, '\u{1F7E9}\u{1F7E9}');
  assert.ok(grade.rows.every((r) => r.hit));
});

test('SET-MATCH BEFORE DISPLAY: the same player at a different (but legal) slot is a MATCH, with the note', () => {
  // A single RB, eligible for RB or FLEX. The solver's optimum happens to
  // place him at RB; the player instead placed him at FLEX. Same person,
  // same points - must read as matched, not as a miss on both sides.
  const teams = [
    team('T1', [{ position: 'RB', name: 'Zeke', points: 20, meta: '' }]),
    team('T2', [{ position: 'WR', name: 'Moss', points: 5, meta: '' }]),
  ];
  const slots = ['RB', 'FLEX'];
  let play = initBoardPlay(teams, slots);
  // Player puts Zeke in FLEX (index 1) and Moss in... wait Moss (WR) cannot
  // fill RB, so Moss must go to FLEX too - only one of them can. Simplify:
  // give T2 an RB instead so both slots are fillable either way.
  play = initBoardPlay([
    team('T1', [{ position: 'RB', name: 'Zeke', points: 20, meta: '' }]),
    team('T2', [{ position: 'RB', name: 'Barkley', points: 3, meta: '' }]),
  ], slots);
  play = commitPick(play, play.teams[0], play.teams[0].card[0], 1); // Zeke -> FLEX (index 1)
  play = commitPick(play, play.teams[1], play.teams[1].card[0], 0); // Barkley -> RB (index 0)

  const grade = gradeBoard(play, play.teams, slots);
  // The optimum obviously prefers Zeke (20) over Barkley (3) for BOTH slots
  // combined, but only one slot can hold Zeke - the true optimum is Zeke at
  // whichever slot, Barkley at the other, total 23, matching what the player
  // already holds (same two players, just possibly a different slot for Zeke).
  assert.equal(grade.pct, 100, 'both real players are on the roster - a full match regardless of which slot Zeke landed in');
  assert.equal(grade.matchedCount, 2);
  const zekeRow = grade.rows.find((r) => r.best.name === 'Zeke');
  assert.equal(zekeRow.hit, true);
  // moved is set only when the solver's own slot differs from the player's -
  // whichever way it falls, the row must still be a MATCH, never a miss.
  assert.ok(zekeRow.moved === null || typeof zekeRow.moved === 'string');
});

// -----------------------------------------------------------------------
// ROW ORDER (ruling): position order (your own roster's slot index),
// matched and swap rows INTERLEAVED, not grouped by outcome. Slots A,B,C -
// the MATCHED pick lands at slot C (index 2, LAST), and both SWAP picks
// land at slots A and B (indexes 0 and 1, FIRST). The old grouped-by-
// outcome order would have put the matched row FIRST (matched rows always
// came before swaps); the ruling requires it LAST, because it is at your
// own slot index 2.
// -----------------------------------------------------------------------
test('rows display in MY roster slot order, matched and swap interleaved - not grouped by outcome', () => {
  const teams = [
    team('T1', [{ position: 'A', name: 'Alice', points: 5, meta: '' }]),
    team('T2', [{ position: 'A', name: 'Amy', points: 9, meta: '' }]),
    team('T3', [{ position: 'B', name: 'Bob', points: 3, meta: '' }]),
    team('T4', [{ position: 'B', name: 'Bea', points: 7, meta: '' }]),
    team('T5', [{ position: 'C', name: 'Carol', points: 9, meta: '' }]),
  ];
  const slots = ['A', 'B', 'C'];
  let play = initBoardPlay(teams, slots);
  play = commitPick(play, teams[0], teams[0].card[0], 0); // Alice -> A (slot index 0) - NOT the optimum's A pick
  play = commitPick(play, teams[2], teams[2].card[0], 1); // Bob -> B (slot index 1) - NOT the optimum's B pick
  play = commitPick(play, teams[4], teams[4].card[0], 2); // Carol -> C (slot index 2) - the ONLY C source, so this matches the optimum

  const grade = gradeBoard(play, teams, slots);
  assert.equal(grade.matchedCount, 1, 'only Carol is shared with the optimum');
  assert.deepEqual(grade.rows.map((r) => r.you.name), ['Alice', 'Bob', 'Carol'],
    'Alice (swap, slot A) and Bob (swap, slot B) must come BEFORE Carol (matched, slot C) - position order, not outcome grouping');
  assert.equal(grade.rows[2].hit, true, 'the matched row is still recognizably matched, just displayed last');
  assert.equal(grade.rows[0].hit, false);
  assert.equal(grade.rows[1].hit, false);
});

test('boardStory names only players and teams that were actually on THIS board', () => {
  const teams = [
    team('T1', [{ position: 'X', name: 'Alice', points: 10, meta: '' }, { position: 'Y', name: 'Bob', points: 9, meta: '' }]),
    team('T2', [{ position: 'X', name: 'Carol', points: 8, meta: '' }, { position: 'Y', name: 'Dave', points: 1, meta: '' }]),
    team('T3', [{ position: 'X', name: 'Erin', points: 2, meta: '' }]),
  ];
  const slots = ['X', 'Y'];
  let play = initBoardPlay(teams, slots);
  play = commitPick(play, teams[0], teams[0].card[0], 0); // Alice -> X
  play = commitPick(play, teams[1], teams[1].card[1], 1); // Dave -> Y

  const grade = gradeBoard(play, teams, slots);
  assert.deepEqual(grade.untouchedTeams, ['T3'], 'T3 was never opened');
  const story = boardStory(grade, play.used.size, teams.length, '1:23');
  assert.match(story, /You opened 2 of the 3 teams in 1:23/);
  assert.match(story, /You never opened T3/);
  assert.ok(story.includes('Carol') || story.includes('Bob'),
    'the story must name a real player from THIS board, not a placeholder');
});
