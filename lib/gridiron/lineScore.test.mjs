// lib/gridiron/lineScore.test.mjs - the quarter grid.
//
// The card's expand is client state, so a server render cannot reach the grid.
// The derivation is therefore pure and tested here against the two real data
// shapes the database actually holds:
//
//   API-Sports (2026 preseason)  complete quarters, e.g. [0, 17, 0, 16, null]
//   BDL (2025 regular season)    PATCHY, e.g. [7, 13, null, null, null]
//
// The second one is the reason this file exists. A grid that summed its own
// quarters would print 20 next to a game that finished 27-21.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineScoreGrid, quartersReconcile, ABSENT } from './lineScore.js';

const game = ({ home, away, hs, as }) => ({
  lineScores: { home, away },
  home: { abbreviation: 'ARI', name: 'Arizona Cardinals' },
  away: { abbreviation: 'CAR', name: 'Carolina Panthers' },
  homeScore: hs, awayScore: as,
});

// The real Hall of Fame game, verbatim from PROD metadata.
const HOF = game({ home: [0, 17, 3, 10, null], away: [0, 17, 0, 16, null], hs: 30, as: 33 });
// A real 2025 BDL row, verbatim: two quarters recorded, two missing.
const PATCHY = game({ home: [7, 14, 3, null, null], away: [7, 13, null, null, null], hs: 24, as: 20 });

test('a complete game renders four quarters and both totals', () => {
  const grid = lineScoreGrid(HOF);
  assert.deepEqual(grid.columns, ['1', '2', '3', '4'], 'no OT column when nobody scored in OT');
  assert.equal(grid.hasOt, false);
  assert.deepEqual(grid.rows.map((r) => r.abbr), ['CAR', 'ARI'], 'away first, as on the card');
  assert.deepEqual(grid.rows[0].cells, [0, 17, 0, 16]);
  assert.deepEqual(grid.rows[1].cells, [0, 17, 3, 10]);
  assert.equal(grid.rows[0].total, 33);
  assert.equal(grid.rows[1].total, 30);
});

test('ZERO IS A SCORE AND RENDERS AS ONE', () => {
  // Both teams were shut out in the first quarter of the HOF game. A truthy
  // check would have turned those into dashes and quietly claimed the quarter
  // was unrecorded.
  const grid = lineScoreGrid(HOF);
  assert.equal(grid.rows[0].cells[0], 0);
  assert.notEqual(grid.rows[0].cells[0], ABSENT);
});

test('A MISSING QUARTER IS A DASH, AND THE TOTAL STILL COMES FROM THE SCORE', () => {
  // The defect this whole module exists to prevent. Away has 7 and 13 recorded
  // against a final of 20 - which happens to add up - while home has 7, 14, 3
  // against 24, which does not.
  const grid = lineScoreGrid(PATCHY);
  assert.deepEqual(grid.rows[0].cells, [7, 13, ABSENT, ABSENT]);
  assert.deepEqual(grid.rows[1].cells, [7, 14, 3, ABSENT]);
  assert.equal(grid.rows[0].total, 20, 'the total is the provider score, not the row sum');
  assert.equal(grid.rows[1].total, 24);
  // Proof the sum would have been wrong: 7 + 14 + 3 = 24 here by luck, but the
  // away row sums to 20 with two quarters missing, which is a coincidence and
  // not a guarantee. The grid never relies on either.
  assert.notEqual(grid.rows[1].cells.filter((v) => v !== ABSENT).reduce((a, b) => a + b, 0), 27);
});

test('the OT column appears only when someone scored in overtime', () => {
  const reg = lineScoreGrid(game({ home: [7, 7, 7, 7, null], away: [3, 3, 3, 3, null], hs: 28, as: 12 }));
  assert.deepEqual(reg.columns, ['1', '2', '3', '4'], 'a permanently empty OT column is the Watch-unit defect again');

  const ot = lineScoreGrid(game({ home: [7, 7, 7, 7, 3], away: [7, 7, 7, 7, 0], hs: 31, as: 28 }));
  assert.deepEqual(ot.columns, ['1', '2', '3', '4', 'OT']);
  assert.equal(ot.hasOt, true);
  assert.deepEqual(ot.rows[1].cells, [7, 7, 7, 7, 3]);
  assert.equal(ot.rows[0].cells[4], 0, 'a scoreless OT for one side is still a played OT');
});

test('no line score at all yields no grid, not an empty one', () => {
  // Every scheduled game. The card shows the pre-game facts instead.
  for (const bad of [
    {}, { lineScores: null }, { lineScores: {} },
    { lineScores: { home: [1, 2, 3, 4] } },
    { lineScores: { away: [1, 2, 3, 4] } },
    { lineScores: { home: 'x', away: 'y' } },
  ]) {
    assert.equal(lineScoreGrid(bad), null, JSON.stringify(bad));
  }
  assert.equal(lineScoreGrid(null), null);
});

test('a missing total is a dash, never a zero', () => {
  const g = lineScoreGrid(game({ home: [7, 0, 0, 0, null], away: [0, 0, 0, 0, null], hs: null, as: null }));
  assert.equal(g.rows[0].total, ABSENT);
  assert.equal(g.rows[1].total, ABSENT);
});

test('the row label falls back through abbreviation, name, TBD', () => {
  const g = lineScoreGrid({
    lineScores: { home: [0, 0, 0, 0], away: [0, 0, 0, 0] },
    home: { name: 'Ohio State' }, away: {},
    homeScore: 0, awayScore: 0,
  });
  assert.equal(g.rows[0].abbr, 'TBD', 'an unseeded side still labels its row');
  assert.equal(g.rows[1].abbr, 'Ohio State', 'CFB teams often have no abbreviation stored');
});

// ---------------------------------------------------------------------------
// The reconciliation signal
// ---------------------------------------------------------------------------

test('quartersReconcile reports agreement, and refuses to guess on a gap', () => {
  assert.equal(quartersReconcile([7, 7, 7, 7, null], 28), true);
  assert.equal(quartersReconcile([7, 7, 7, 7, null], 31), false, 'a real disagreement is reported');
  assert.equal(quartersReconcile([7, 13, null, null, null], 20), null,
    'an incomplete row cannot disagree with anything');
  assert.equal(quartersReconcile(null, 20), null);
  assert.equal(quartersReconcile([7, 7, 7, 7], null), null);
});

test('reconciliation NEVER changes what is displayed', () => {
  // It is a data-quality signal about the feed, not an input to rendering. The
  // provider's total always wins on the card.
  const g = lineScoreGrid(game({ home: [7, 7, 7, 7, null], away: [0, 0, 0, 0, null], hs: 99, as: 0 }));
  assert.equal(quartersReconcile([7, 7, 7, 7, null], 99), false, 'the quarters disagree');
  assert.equal(g.rows[1].total, 99, 'and the card still shows the provider total');
});
