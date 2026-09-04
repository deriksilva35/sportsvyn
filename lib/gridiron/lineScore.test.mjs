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

// ---------------------------------------------------------------------------
// THE LIVE CHIP + period-aware columns (scoreboard live-state relay)
// ---------------------------------------------------------------------------

const { liveChip, periodOf } = await import('./lineScore.js');

test('the chip speaks the quarter grammar, OT and halftime included', () => {
  assert.equal(liveChip({ short: 'Q4', clock: '8:12' }), 'Q4 · 8:12');
  assert.equal(liveChip({ short: 'Q1', clock: '14:54' }), 'Q1 · 14:54');
  assert.equal(liveChip({ short: 'OT', clock: '9:33' }), 'OT · 9:33');
  assert.equal(liveChip({ short: 'Q2', clock: null }), 'Q2', 'no clock, no invented one');
  assert.equal(liveChip({ short: 'HT', clock: null }), 'HALF');
  assert.equal(liveChip({ short: 'Halftime', clock: null }), 'HALF');
  assert.equal(liveChip({ short: 'end of period', clock: null }), 'END Q');
  assert.equal(liveChip({ short: 'XX9', clock: '1:00' }), 'XX9 · 1:00',
    'an unknown short renders as itself - honest beats invented');
});

test('scheduled and final carry no chip - null in, null out', () => {
  assert.equal(liveChip(null), null);
  assert.equal(liveChip({ short: null, clock: '5:00' }), null);
});

// ---------------------------------------------------------------------------
// THE TWO SHAPES A live_state ROW MAY HOLD. {period, clock} is what
// services/live-poller/poll.mjs actually writes in production (the droplet
// process that wins the write race); {short, clock} is the older
// apiSportsImport.js shape, still sitting on rows written before the CFB
// live poller existed. liveChip() must render a real chip from either, on
// a live game, every time - that guarantee is the whole fix. See
// lib/live/vocabulary.js: shortOf() for the derivation both shapes share.
// ---------------------------------------------------------------------------
test('a {period, clock} row yields a chip - the shape actually written today', () => {
  assert.equal(liveChip({ period: 1, clock: '14:54' }), 'Q1 · 14:54');
  assert.equal(liveChip({ period: 4, clock: '2:00' }), 'Q4 · 2:00');
  assert.equal(liveChip({ period: 6, clock: '9:33' }), 'OT · 9:33', 'anything past 4 is OT');
  assert.equal(liveChip({ period: 2, clock: '00:00' }), 'HALF', 'the derived halftime rule');
});

test('a {short, clock} row still yields a chip - old rows exist and are not migrated', () => {
  assert.equal(liveChip({ short: 'Q3', clock: '9:12' }), 'Q3 · 9:12');
  assert.equal(liveChip({ short: 'HT', clock: '00:00' }), 'HALF');
});

test('neither shape returns null on a live game with a real clock', () => {
  assert.notEqual(liveChip({ period: 3, clock: '11:04' }), null);
  assert.notEqual(liveChip({ short: 'Q3', clock: '11:04' }), null);
});

test('live columns follow the period reached; final keeps all four', () => {
  const live = (short, line) => ({
    ...game({ home: line, away: line, hs: 10, as: 7 }),
    status: 'live', liveState: { short, clock: '5:00' },
  });
  assert.deepEqual(lineScoreGrid(live('Q1', [0, null, null, null, null])).columns, ['1']);
  assert.deepEqual(lineScoreGrid(live('Q2', [0, 7, null, null, null])).columns, ['1', '2']);
  assert.deepEqual(lineScoreGrid(live('HT', [0, 7, null, null, null])).columns, ['1', '2'],
    'halftime shows the half played');
  assert.deepEqual(lineScoreGrid(live('Q4', [0, 7, 3, 0, null])).columns, ['1', '2', '3', '4']);
  assert.deepEqual(lineScoreGrid(live('OT', [0, 7, 3, 0, null])).columns, ['1', '2', '3', '4', 'OT'],
    'OT column appears when reached, scored-in or not');
  // A live game with no live_state falls back to the full four - honest.
  const noState = { ...game({ home: [0, 7, null, null, null], away: [0, 3, null, null, null], hs: 7, as: 3 }), status: 'live' };
  assert.deepEqual(lineScoreGrid(noState).columns, ['1', '2', '3', '4']);
  // Final: all four, OT only when scored in - unchanged law.
  assert.deepEqual(lineScoreGrid({ ...HOF, status: 'final' }).columns, ['1', '2', '3', '4']);
});

test('periodOf maps shorts to periods and refuses the rest', () => {
  assert.equal(periodOf({ short: 'Q3' }), 3);
  assert.equal(periodOf({ short: 'OT' }), 5);
  assert.equal(periodOf({ short: 'HT' }), 2);
  assert.equal(periodOf({ short: 'FT' }), null);
  assert.equal(periodOf(null), null);
});

test('periodOf maps {period, clock} rows too, the shape actually written', () => {
  assert.equal(periodOf({ period: 3, clock: '9:00' }), 3);
  assert.equal(periodOf({ period: 6, clock: '9:00' }), 5, 'anything past 4 reads as OT, period 5');
  assert.equal(periodOf({ period: 2, clock: '00:00' }), 2, 'the derived halftime case');
});

test('ONE definition: the scoreboard renders chip and grid from THIS module', async () => {
  const { readFileSync } = await import('node:fs');
  const t = readFileSync(new URL('../../components/gridiron/Scoreboard.js', import.meta.url), 'utf8');
  assert.match(t, /import \{ lineScoreGrid, liveChip, ABSENT \} from '@\/lib\/gridiron\/lineScore'/);
  assert.ok(!/liveState\.short|liveState\.clock/.test(t),
    'the component never hand-formats the chip - liveChip owns the grammar');
});

test('the one-definition pin extends to the FULL GAME page (the recon miss)', async () => {
  const { readFileSync } = await import('node:fs');
  const t = readFileSync(new URL('../../app/nfl/game/[slug]/page.js', import.meta.url), 'utf8');
  assert.match(t, /import \{ lineScoreGrid, liveChip \} from '@\/lib\/gridiron\/lineScore'/);
  assert.match(t, /liveChip\(game\.liveState\)/);
  assert.ok(!/liveState\.short|liveState\.clock/.test(t),
    'the page never hand-formats the chip either');
});
