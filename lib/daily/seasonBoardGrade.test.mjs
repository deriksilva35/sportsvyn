// lib/daily/seasonBoardGrade.test.mjs — the grade, hand-worked before it is
// ever pointed at a real completed board.

import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeBoard, boardStory } from './seasonBoardGrade.js';
import { initBoardPlay, commitPick } from './seasonBoardPlay.js';
import { solveBoard } from './assignmentSolver.js';
import { eligibleForSlot } from './boardShape.js';

const team = (key, card) => ({ key, abbr: key, card });

// -----------------------------------------------------------------------
// THE HAND-WORKED CASE. Slots X, Y. T1 fields Alice(X,10) and Bob(Y,9);
// T2 fields Carol(X,8) and Dave(Y,1). The true optimum (same arithmetic as
// assignmentSolver.test.mjs's identical numbers): X->Carol(T2,8),
// Y->Bob(T1,9) = 17.
//
// The PLAYER instead picks Alice(T1) for X and Dave(T2) for Y - total 11,
// zero names in common with the optimum. EVERY ROW IS SLOT-INDEXED (ruling):
// your X pick reads against the best roster's OWN X occupant, never against
// whichever leftover happened to be closest in value.
//   Alice(10, your X) vs Carol(8, best's X)  -> Alice scored MORE: ahead by +2
//   Dave(1, your Y)   vs Bob(9, best's Y)    -> Dave scored LESS: a miss, -8
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
  assert.equal(aheadRow.best.name, 'Carol', "Alice is YOUR slot-X pick - it reads against best's slot-X occupant, Carol, never Bob (slot Y)");
  assert.equal(aheadRow.best.slot, 'X');

  const missRow = grade.rows.find((r) => r.you?.name === 'Dave');
  assert.equal(missRow.hit, false);
  assert.equal(missRow.ahead, false);
  assert.equal(missRow.best.name, 'Bob', "Dave is YOUR slot-Y pick - it reads against best's slot-Y occupant, Bob");
  assert.equal(missRow.best.slot, 'Y');
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
// THE REAL SHAPE, THE REAL DEFECT. QB/RB/RB/WR/WR/FLEX/FLEX/K, nine teams
// (one slack team: a second QB source, Purdy, so the PLAYER can legally take
// a different QB than the best roster's own Lamar). The bug this fixture
// reproduces: under value-sorted pairing, the QB row could show Purdy
// against McCaffrey (a QB label over a RB body) because McCaffrey's points
// happened to be the closest leftover value - a legal best roster, filed
// under the wrong slot. Every row.best.slot === row.you.slot proves that
// structurally can't happen any more: best[i] is either untouched (and
// bySlot[i].slot already equals slots[i]) or explicitly relabelled to
// slots[i] by permuteBest - there is no third path that could drift.
// -----------------------------------------------------------------------
const SLOTS8 = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'];

test('every row is slot-aligned on both sides - the best roster never shows up under the wrong label', () => {
  const teams = [
    team('T1', [{ position: 'QB', name: 'Lamar Jackson', points: 30, meta: '' }]),
    team('T9', [{ position: 'QB', name: 'Brock Purdy', points: 22, meta: '' }]),
    team('T2', [{ position: 'RB', name: 'Christian McCaffrey', points: 25, meta: '' }]),
    team('T3', [{ position: 'RB', name: 'Saquon Barkley', points: 20, meta: '' }]),
    team('T4', [{ position: 'WR', name: 'Tyreek Hill', points: 18, meta: '' }]),
    team('T5', [{ position: 'WR', name: 'Ja\'Marr Chase', points: 17, meta: '' }]),
    team('T6', [{ position: 'TE', name: 'Travis Kelce', points: 15, meta: '' }]),
    team('T7', [{ position: 'RB', name: 'Derrick Henry', points: 12, meta: '' }]),
    team('T8', [{ position: 'PK', name: 'Justin Tucker', points: 10, meta: '' }]),
  ];
  let play = initBoardPlay(teams, SLOTS8);
  // YOUR roster, deliberately not the optimum's: Purdy at QB (not Lamar).
  play = commitPick(play, teams[1], teams[1].card[0], 0); // Purdy -> QB
  play = commitPick(play, teams[2], teams[2].card[0], 1); // McCaffrey -> RB
  play = commitPick(play, teams[3], teams[3].card[0], 2); // Barkley -> RB
  play = commitPick(play, teams[4], teams[4].card[0], 3); // Hill -> WR
  play = commitPick(play, teams[5], teams[5].card[0], 4); // Chase -> WR
  play = commitPick(play, teams[6], teams[6].card[0], 5); // Kelce -> FLEX
  play = commitPick(play, teams[7], teams[7].card[0], 6); // Henry -> FLEX
  play = commitPick(play, teams[8], teams[8].card[0], 7); // Tucker -> K

  const grade = gradeBoard(play, teams, SLOTS8);
  assert.equal(grade.ok, true);
  assert.equal(grade.rows[0].best.name, 'Lamar Jackson', "the best roster's QB is Lamar - the only team with no other use");
  SLOTS8.forEach((slot, i) => {
    assert.equal(grade.rows[i].best.slot, slot, `row ${i} (${slot}): best.slot must equal the slot it's displayed at`);
    assert.equal(grade.rows[i].you.slot, slot, `row ${i} (${slot}): you.slot must equal the slot it's displayed at`);
  });
});

// -----------------------------------------------------------------------
// THE PERMUTATION, NAMED. Two RB slots share one eligibility rule, so which
// of the two the solver happens to assign a given player to is a tie the
// algorithm is free to break either way - this fixture doesn't guess which:
// it calls solveBoard() itself first to find out, then deliberately commits
// the PLAYER's Etienne to the OTHER RB slot, guaranteeing a same-name,
// different-index match every run, never flaky on the solver's tie-break.
// -----------------------------------------------------------------------
test('a same-slot-name swap (RB1 vs RB2) still resolves to a MATCH, with the moved note, and a legal, ceiling-equal permutation', () => {
  const teams = [
    team('T1', [{ position: 'QB', name: 'QB One', points: 20, meta: '' }]),
    team('T2', [{ position: 'RB', name: 'Etienne', points: 22, meta: '' }]),
    team('T3', [{ position: 'RB', name: 'Cook', points: 18, meta: '' }]),
    team('T4', [{ position: 'WR', name: 'Adams', points: 15, meta: '' }]),
    team('T5', [{ position: 'WR', name: 'Chase', points: 14, meta: '' }]),
    team('T6', [{ position: 'TE', name: 'Kelce', points: 8, meta: '' }]),
    team('T7', [{ position: 'TE', name: 'Waller', points: 7, meta: '' }]),
    team('T8', [{ position: 'PK', name: 'Tucker', points: 5, meta: '' }]),
  ];

  const optimum = solveBoard(teams, SLOTS8);
  assert.equal(optimum.ok, true);
  const RB_INDEXES = [1, 2]; // SLOTS8's two RB instances
  const optEtienneIdx = optimum.bySlot.findIndex((b) => b.player.name === 'Etienne');
  assert.ok(RB_INDEXES.includes(optEtienneIdx), 'the fixture only makes sense if the solver put Etienne at an RB slot');
  const yourEtienneIdx = RB_INDEXES.find((i) => i !== optEtienneIdx);
  const yourOtherRbIdx = optEtienneIdx;
  const cookTeam = teams.find((t) => t.card[0].name === 'Cook');
  const etienneTeam = teams.find((t) => t.card[0].name === 'Etienne');

  let play = initBoardPlay(teams, SLOTS8);
  play = commitPick(play, teams[0], teams[0].card[0], 0); // QB One -> QB
  play = commitPick(play, etienneTeam, etienneTeam.card[0], yourEtienneIdx);
  play = commitPick(play, cookTeam, cookTeam.card[0], yourOtherRbIdx);
  play = commitPick(play, teams[3], teams[3].card[0], 3); // Adams -> WR
  play = commitPick(play, teams[4], teams[4].card[0], 4); // Chase -> WR
  play = commitPick(play, teams[5], teams[5].card[0], 5); // Kelce -> FLEX
  play = commitPick(play, teams[6], teams[6].card[0], 6); // Waller -> FLEX
  play = commitPick(play, teams[7], teams[7].card[0], 7); // Tucker -> K

  const grade = gradeBoard(play, teams, SLOTS8);
  assert.equal(grade.ok, true);

  const row = grade.rows[yourEtienneIdx];
  assert.equal(row.hit, true, 'same player, different RB slot - still a MATCH');
  assert.equal(row.you.name, 'Etienne');
  assert.equal(row.best.name, 'Etienne');
  assert.equal(row.moved, 'RB', 'the permutation moved him to line up with your slot - the note fires');

  // LEGALITY: every row's best occupant is eligible for the slot it's
  // finally shown at - the assertion this file's own permuteBest also makes
  // internally, checked again here from the outside.
  SLOTS8.forEach((slot, i) => {
    assert.ok(eligibleForSlot(grade.rows[i].best.position, slot), `row ${i}: ${grade.rows[i].best.name} must be eligible for ${slot}`);
  });

  // CEILING UNCHANGED: a permutation relabels who's shown where - it is
  // never a re-solve, so the permuted best roster's own total must still
  // equal solveBoard's own total exactly.
  const permutedTotal = grade.rows.reduce((s, r) => s + r.best.points, 0);
  assert.ok(Math.abs(permutedTotal - optimum.total) < 0.1, `permuted total ${permutedTotal} must equal the ceiling ${optimum.total}`);
});

// -----------------------------------------------------------------------
// THE ARITHMETIC INVARIANT: summing you.points - best.points across every
// row is just mine minus perfect, re-derived a different way - proof the
// per-row deltas and the headline pct/pointsLeft numbers can never disagree.
// -----------------------------------------------------------------------
test('sum of row deltas equals yourScore minus the ceiling, to 0.1', () => {
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
  const deltaSum = grade.rows.reduce((s, r) => s + (r.you.points - r.best.points), 0);
  assert.ok(Math.abs(deltaSum - (grade.mine - grade.perfect)) < 0.1, `delta sum ${deltaSum} must equal mine(${grade.mine}) - perfect(${grade.perfect})`);
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
