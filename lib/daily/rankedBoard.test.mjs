// lib/daily/rankedBoard.test.mjs - the generator and the solver at the ranked
// shape (v2.0). PURE: fixtures in, a board out. No database.
//
// THE FIXTURES ARE SHAPED LIKE nfl_player_season_totals ROWS, because that is
// what generateBoard is handed - team_key, position, raw_name and the stat
// columns fantasyPoints reads through toSeasonStatLine.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBoard, buildCard, cardsBySeasonTeam } from './boardGenerator.js';
import { solveBoard } from './assignmentSolver.js';
import { clearSlot, commitPick, initBoardPlay, legalSlotIndexes } from './seasonBoardPlay.js';
import { SLOTS, LEGACY_SLOTS } from './boardShape.js';
import { makeRng } from './pool.js';

/** One season row. Points come out of the real scorer, never typed in. */
const row = (team, position, name, stats = {}) => ({
  team_key: team, position, raw_name: name,
  pass_yds: null, pass_td: null, pass_int: null, rush_yds: null, rush_td: null,
  rec: null, rec_yds: null, rec_td: null, fumbles_lost: null,
  fgm: null, fga: null, xp: null, sacks: null, def_int: null, def_td: null,
  ...stats,
});

/** A team that can fill anything: QB, two RB, two WR, a TE and a kicker. */
function fullTeam(team, scale = 1) {
  return [
    row(team, 'QB', `${team} QB`, { pass_yds: 4000 * scale, pass_td: 30 }),
    row(team, 'RB', `${team} RB1`, { rush_yds: 1200 * scale, rush_td: 10 }),
    row(team, 'RB', `${team} RB2`, { rush_yds: 700 * scale, rush_td: 4 }),
    row(team, 'WR', `${team} WR1`, { rec: 100, rec_yds: 1400 * scale, rec_td: 9 }),
    row(team, 'WR', `${team} WR2`, { rec: 70, rec_yds: 900 * scale, rec_td: 5 }),
    row(team, 'TE', `${team} TE`, { rec: 80, rec_yds: 850 * scale, rec_td: 6 }),
    row(team, 'PK', `${team} K`, { fgm: 30, xp: 45 }),
  ];
}

/** The same team with no tight end anywhere - the 1991 problem, synthesised. */
function teamWithoutTe(team, scale = 1) {
  return fullTeam(team, scale).filter((r) => r.position !== 'TE');
}

const seasonOf = (teams, make) => teams.flatMap((t, i) => make(t, 1 - i * 0.02));
const TEAMS = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III', 'JJJ', 'KKK', 'LLL'];

// ---------------------------------------------------------------------------
// THE DRAW
// ---------------------------------------------------------------------------

test('a twelve-team draw off a modern season solves at the ranked shape', () => {
  const draw = generateBoard(seasonOf(TEAMS, fullTeam), makeRng('ranked-1'));
  assert.equal(draw.ok, true, draw.reason);
  assert.equal(draw.teams.length, 12);
  const solved = solveBoard(draw.teams, SLOTS);
  assert.equal(solved.ok, true, solved.reason);
  assert.equal(solved.bySlot.length, 8);
  assert.deepEqual(solved.bySlot.map((b) => b.slot), [...SLOTS]);
});

test('THE TE SLOT IS FILLED BY A TIGHT END, not by the FLEX rule leaking', () => {
  const draw = generateBoard(seasonOf(TEAMS, fullTeam), makeRng('ranked-2'));
  const solved = solveBoard(draw.teams, SLOTS);
  const te = solved.bySlot.find((b) => b.slot === 'TE');
  assert.equal(te.player.position, 'TE');
});

test('one team per slot, still - eight distinct teams out of twelve', () => {
  const draw = generateBoard(seasonOf(TEAMS, fullTeam), makeRng('ranked-3'));
  const solved = solveBoard(draw.teams, SLOTS);
  assert.equal(new Set(solved.teamsUsed).size, 8);
});

test('A SEASON WITH NO TIGHT END ANYWHERE CANNOT SOLVE - this is the redraw', () => {
  // The guard R1 keeps. It measured 0 of 6,900 on the real 2002-2025 corpus,
  // so it is exercised here against a synthetic season rather than a real one:
  // the point is that an unfillable draw is REFUSED, not quietly shipped with
  // an empty slot.
  const draw = generateBoard(seasonOf(TEAMS, teamWithoutTe), makeRng('ranked-4'));
  assert.equal(draw.ok, true, 'the draw itself is fine - twelve teams, six cards');
  const solved = solveBoard(draw.teams, SLOTS);
  assert.equal(solved.ok, false);
  assert.match(solved.reason, /feasible/);
  // And the same board solves perfectly well under the shape it belongs to.
  assert.equal(solveBoard(draw.teams, LEGACY_SLOTS).ok, true);
});

test('one tight end among twelve teams is enough', () => {
  // The board needs a TE SOMEWHERE, not on every card - measured on PROD and
  // fixed here so a future change to the solver cannot quietly require more.
  const rows = seasonOf(TEAMS, teamWithoutTe)
    .concat([row('GGG', 'TE', 'GGG TE', { rec: 60, rec_yds: 700, rec_td: 4 })]);
  const draw = generateBoard(rows, makeRng('ranked-5'));
  const solved = solveBoard(draw.teams, SLOTS);
  assert.equal(solved.ok, true, solved.reason);
  // The solver works on the RAW season rows, where the name column is
  // raw_name - shapeTeams maps it to `name` later, for the UI only.
  assert.equal(solved.bySlot.find((b) => b.slot === 'TE').player.raw_name, 'GGG TE');
});

test('a card is still the team\'s own top six, kicker rule unchanged', () => {
  const card = buildCard(fullTeam('AAA'));
  assert.equal(card.players.length, 6);
  assert.equal(card.players[0].points >= card.players[5].points, true);
  assert.equal(card.standout, card.players[0]);
  const byTeam = cardsBySeasonTeam(seasonOf(TEAMS, fullTeam));
  assert.equal(byTeam.size, 12);
});

// ---------------------------------------------------------------------------
// PLAY, AT THE NEW SHAPE
// ---------------------------------------------------------------------------

test('a WR cannot be placed in the TE slot, and a TE can', () => {
  const play = initBoardPlay([], SLOTS);
  assert.deepEqual(legalSlotIndexes(play, 'TE'), [5, 6]);   // the TE slot and the FLEX
  assert.deepEqual(legalSlotIndexes(play, 'WR'), [3, 4, 6]); // two WR and the FLEX, never 5
  assert.deepEqual(legalSlotIndexes(play, 'QB'), [0]);
  assert.deepEqual(legalSlotIndexes(play, 'PK'), [7]);
});

test('CLEARING A FILLED SLOT GIVES THE TEAM BACK', () => {
  // The mock's own copy - "keep swapping, tap any filled slot to clear it" -
  // reversing the old commit-on-open rule.
  const team = { key: 'AAA', abbr: 'AAA', card: [] };
  const player = { name: 'AAA QB', position: 'QB', points: 300 };
  const play = commitPick(initBoardPlay([team], SLOTS), team, player, 0);
  assert.equal(play.used.has('AAA'), true);
  assert.equal(play.roster[0].pick.player.name, 'AAA QB');
  const back = clearSlot(play, 0);
  assert.equal(back.roster[0].pick, null);
  assert.equal(back.used.has('AAA'), false, 'the team is spendable again');
  // And the state that was cleared is untouched - no mutation.
  assert.equal(play.roster[0].pick.player.name, 'AAA QB');
});

test('clearing one slot does not release a team another slot still holds', () => {
  // Not reachable by a legal play - one team fills one slot - but the rebuild
  // is from what remains rather than a decrement precisely so that a future
  // rule change cannot make it release a team twice.
  const team = { key: 'AAA', abbr: 'AAA', card: [] };
  let play = initBoardPlay([team], SLOTS);
  play = commitPick(play, team, { name: 'a', position: 'RB', points: 10 }, 1);
  play = commitPick(play, team, { name: 'b', position: 'RB', points: 9 }, 2);
  const back = clearSlot(play, 1);
  assert.equal(back.used.has('AAA'), true);
});
