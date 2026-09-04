// lib/daily/seasonBoardPlay.test.mjs — the play state machine, including the
// two properties Step 3 was asked to verify: a team offers no way out once
// opened (there is no dismiss/cancel operation anywhere in this module's
// surface, checked structurally below), and a team with nothing legal left
// goes dead on its own, before anyone opens it.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initBoardPlay, legalSlotIndexes, teamIsDead, isRosterComplete,
  filledCount, teamsLeft, pickOutcome, commitPick,
} from './seasonBoardPlay.js';

const p = (position, points) => ({ position, points });
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K'];

// Commits the FIRST legal slot for a pick, auto or ambiguous alike - a
// stand-in for "the player tapped the first slot button offered".
function take(state, team, player) {
  const outcome = pickOutcome(state, player);
  const slotIndex = outcome.auto ? outcome.slotIndex : outcome.slotIndexes[0];
  return commitPick(state, team, player, slotIndex);
}

function board() {
  return [
    { key: 'A', card: [p('QB', 300)] },
    { key: 'B', card: [p('RB', 250), p('RB', 100)] },
    { key: 'C', card: [p('RB', 200)] },
    { key: 'D', card: [p('WR', 220)] },
    { key: 'E', card: [p('WR', 180)] },
    { key: 'F', card: [p('TE', 150)] }, // FLEX-only eligible - no RB/WR/QB/K slot fits TE directly
    { key: 'G', card: [p('PK', 90)] },
    { key: 'H', card: [p('WR', 50)] }, // an 8th team - with 8 teams and 8 slots, each contributes exactly one pick
  ];
}

test('there is no dismiss/cancel/undo export anywhere in this module - structural proof of "no way out"', async () => {
  const mod = await import('./seasonBoardPlay.js');
  const names = Object.keys(mod);
  for (const forbidden of ['cancel', 'close', 'dismiss', 'undo', 'reset', 'reopen']) {
    assert.ok(!names.some((n) => n.toLowerCase().includes(forbidden)),
      `found a "${forbidden}"-like export - the module must expose no way back out of an opened team`);
  }
});

test('legalSlotIndexes finds every open slot a position fits, FLEX included', () => {
  const state = initBoardPlay(board(), SLOTS);
  assert.deepEqual(legalSlotIndexes(state, 'QB'), [0], 'QB fits only its own slot - never FLEX');
  assert.deepEqual(legalSlotIndexes(state, 'RB'), [1, 2, 5, 6], 'both RB slots AND both FLEX slots - RB is FLEX-eligible');
  assert.deepEqual(legalSlotIndexes(state, 'WR'), [3, 4, 5, 6], 'both WR slots AND both FLEX slots');
  assert.deepEqual(legalSlotIndexes(state, 'TE'), [5, 6], 'FLEX only - there is no dedicated TE slot in this shape');
  assert.deepEqual(legalSlotIndexes(state, 'PK'), [7], 'a kicker (position PK) fits only the K slot - never FLEX');
});

test('a team already used is dead', () => {
  let state = initBoardPlay(board(), SLOTS);
  const teamA = state.teams[0];
  state = take(state, teamA, teamA.card[0]);
  assert.equal(teamIsDead(state, teamA), true);
});

test('DEAD ON THE CHIP ROW, NOT OPENABLE-AND-EMPTY: a team with nothing legal left goes dead without ever being opened', () => {
  let state = initBoardPlay(board(), SLOTS);
  const teamH = state.teams.find((t) => t.key === 'H'); // a lone WR
  assert.equal(teamIsDead(state, teamH), false, 'WR and FLEX slots are all open at the start - H is legal');

  // Fill the exact four WR-eligible slot INDEXES (2 dedicated WR at 3,4 +
  // both FLEX at 5,6) using OTHER teams' players, targeted explicitly so the
  // scenario is deterministic. H is never opened.
  const teamD = state.teams.find((t) => t.key === 'D'); state = commitPick(state, teamD, teamD.card[0], 3);
  const teamE = state.teams.find((t) => t.key === 'E'); state = commitPick(state, teamE, teamE.card[0], 4);
  const teamF = state.teams.find((t) => t.key === 'F'); state = commitPick(state, teamF, teamF.card[0], 5); // TE -> FLEX
  const teamB = state.teams.find((t) => t.key === 'B');
  state = commitPick(state, teamB, teamB.card[1], 6); // second RB -> the last FLEX slot

  assert.equal(legalSlotIndexes(state, 'WR').length, 0, 'sanity: nothing WR-eligible is open anymore');
  assert.equal(teamIsDead(state, teamH), true,
    'H must be dead now - never opened, but nothing on its card fits anything still open');
});

test('pickOutcome asks when more than one slot fits (two dedicated RB slots plus both FLEX, all open)', () => {
  const state = initBoardPlay(board(), SLOTS);
  const teamB = state.teams.find((t) => t.key === 'B');
  const outcome = pickOutcome(state, teamB.card[0]); // RB
  assert.equal(outcome.ok, true);
  assert.equal(outcome.auto, false, 'four slots (2 RB + 2 FLEX) are open - this must ask, not guess one');
  assert.deepEqual(outcome.slotIndexes, [1, 2, 5, 6]);
});

test('pickOutcome auto-commits when only ONE legal slot remains', () => {
  let state = initBoardPlay(board(), SLOTS);
  const teamB = state.teams.find((t) => t.key === 'B'); // RB, eligible for slots 1,2,5,6
  // Fill three of RB's four eligible slots explicitly (RB slot 1, both FLEX
  // 5 and 6), leaving RB slot 2 as the only one still open for B's RB.
  const teamC = state.teams.find((t) => t.key === 'C'); state = commitPick(state, teamC, teamC.card[0], 1);
  const teamD = state.teams.find((t) => t.key === 'D'); state = commitPick(state, teamD, teamD.card[0], 5);
  const teamE = state.teams.find((t) => t.key === 'E'); state = commitPick(state, teamE, teamE.card[0], 6);
  const outcome = pickOutcome(state, teamB.card[0]);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.auto, true, `expected exactly one legal slot left, got ${JSON.stringify(outcome)}`);
  assert.equal(outcome.slotIndex, 2);
});

test('pickOutcome refuses (ok:false) for a player with no legal slot at all - the UI must never reach this via a live chip', () => {
  const state = initBoardPlay([{ key: 'X', card: [p('DEF', 999)] }], SLOTS);
  const outcome = pickOutcome(state, state.teams[0].card[0]);
  assert.equal(outcome.ok, false);
});

test('commitPick never mutates the state passed in - a caller holding the old reference sees it unchanged', () => {
  const state = initBoardPlay(board(), SLOTS);
  const teamA = state.teams[0];
  const before = JSON.stringify({ roster: state.roster, used: [...state.used] });
  take(state, teamA, teamA.card[0]);
  const after = JSON.stringify({ roster: state.roster, used: [...state.used] });
  assert.equal(before, after, 'the original state object must be untouched');
});

test('filledCount, teamsLeft and isRosterComplete track a full play-through correctly', () => {
  let state = initBoardPlay(board(), SLOTS);
  assert.equal(filledCount(state), 0);
  assert.equal(teamsLeft(state), 8);
  assert.equal(isRosterComplete(state), false);

  // A team is spent after ONE pick, never two - all eight teams get a turn
  // so all eight slots can fill, one team per slot.
  for (const key of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    const team = state.teams.find((t) => t.key === key);
    if (teamIsDead(state, team)) continue;
    const player = team.card.find((pl) => pickOutcome(state, pl).ok);
    if (!player) continue;
    state = take(state, team, player);
  }
  assert.equal(isRosterComplete(state), true, `roster incomplete: ${filledCount(state)}/${SLOTS.length} filled`);
  assert.equal(filledCount(state), SLOTS.length);
  assert.equal(teamsLeft(state), 0, 'every team is either used or dead once the roster is complete');
});
