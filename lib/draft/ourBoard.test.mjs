// lib/draft/ourBoard.test.mjs - OUR OWN BOARD: the replacement arithmetic, the
// value it produces, the blend that lets the season take the board over, and
// the shape the room consumes.
//
// THE PURE TESTS RUN ON FIXTURES, on purpose. The rule is the thing being
// tested, and a rule tested against live data stops testing anything the day
// the data moves (poolSnapshot.test.mjs makes the same argument). The one
// DATABASE test at the bottom is deliberately about the OTHER question: not
// "is the arithmetic right" but "does the board this arithmetic produces from
// the real corpus put backs and receivers in front of quarterbacks", which is
// the thing the reader actually asked for and which no fixture can answer.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  replacementRanks, replacementPpg, vorOf, blendWeight, blendRank, orderBoard, boardRow,
  OUR_SOURCE, FULL_WEIGHT_GAMES,
} from './ourBoard.js';

// ---------------------------------------------------------------------------
// 1. THE REPLACEMENT RANKS COME FROM THE CONFIG
// ---------------------------------------------------------------------------
test('the ranked config derives its own replacement ranks, and no year or rank is typed', () => {
  // QB1 RB2 WR3 TE1 FLEX1 over 12 teams:
  //   dedicated  QB 12, RB 24, WR 36, TE 12
  //   flex       12 slots shared RB:WR:TE = 2:3:1 -> 4 / 6 / 2
  //   starters   QB 12, RB 28, WR 42, TE 14, and the replacement is the next man
  const r = replacementRanks({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 }, 12);
  assert.deepEqual(r, { QB: 13, RB: 29, WR: 43, TE: 15 });
});

test('a bigger league moves every replacement rank, because the config moved', () => {
  const r = replacementRanks({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 }, 14);
  // 14 teams: QB 14, RB 28 + 14*2/6 (4.67), WR 42 + 7, TE 14 + 2.33
  assert.deepEqual(r, { QB: 15, RB: 34, WR: 50, TE: 17 });
});

test('no flex is just the dedicated slots', () => {
  assert.deepEqual(replacementRanks({ QB: 1, RB: 2, WR: 2, TE: 1 }, 10),
    { QB: 11, RB: 21, WR: 21, TE: 11 });
});

test('superflex shares with the quarterbacks, which is the whole point of it', () => {
  // QB1 RB2 WR2 TE1 SUPERFLEX1 over 12: the 12 superflex slots share QB:RB:WR:TE
  // = 1:2:2:1 -> QB 2, RB 4, WR 4, TE 2.
  const r = replacementRanks({ QB: 1, RB: 2, WR: 2, TE: 1, SUPERFLEX: 1 }, 12);
  assert.deepEqual(r, { QB: 15, RB: 29, WR: 29, TE: 15 });
});

test('an all-flex config shares evenly rather than dividing by zero', () => {
  const r = replacementRanks({ FLEX: 3 }, 12);
  // 36 flex slots, no dedicated weights anywhere: 12 each to RB/WR/TE.
  assert.deepEqual(r, { QB: 1, RB: 13, WR: 13, TE: 13 });
});

// ---------------------------------------------------------------------------
// 2. THE VALUE ITSELF
// ---------------------------------------------------------------------------
const ppgRows = (pos, ...ppgs) => ppgs.map((ppg, i) => ({ position: pos, name: `${pos}${i + 1}`, ppg }));

test('the replacement ppg is the ppg of the man AT the replacement rank', () => {
  const rows = ppgRows('QB', 30, 25, 20, 17, 12);
  assert.equal(replacementPpg(rows, { QB: 4 }).QB, 17);
});

test('a position thinner than its replacement rank takes the last man measured', () => {
  const rows = ppgRows('TE', 18, 11);
  // Rank 15 does not exist; 11 is the shallowest honest answer, and 0 would
  // hand every tight end a free VOR equal to his whole output.
  assert.equal(replacementPpg(rows, { TE: 15 }).TE, 11);
});

test('a position with nobody measured has no replacement, and so no value', () => {
  assert.equal(replacementPpg([], { QB: 13 }).QB, null);
  assert.equal(vorOf(20, null), null);
  assert.equal(vorOf(null, 12), null);
});

test('vor is ppg minus the replacement at his position, to a tenth', () => {
  assert.equal(vorOf(23.4, 17), 6.4);
  assert.equal(vorOf(22.3, 11.2), 11.1);
  // A starter-level quarterback and a starter-level back can score the same
  // and be worth wildly different amounts. That is the whole idea.
  assert.equal(vorOf(20, 17), 3);      // QB, replacement 17
  assert.equal(vorOf(20, 11.2), 8.8);  // RB, replacement 11.2
});

test('a man below his own replacement is worth less than nothing, and says so', () => {
  assert.equal(vorOf(8.5, 11.2), -2.7);
});

// ---------------------------------------------------------------------------
// 3. THE BLEND, AT 0 / 1 / 6 GAMES
// ---------------------------------------------------------------------------
test('the weight is min(games, 6) / 6', () => {
  assert.equal(blendWeight(0), 0);
  assert.equal(blendWeight(1), 1 / 6);
  assert.equal(blendWeight(3), 0.5);
  assert.equal(blendWeight(FULL_WEIGHT_GAMES), 1);
  assert.equal(blendWeight(17), 1, 'it never exceeds 1 - week 12 is not more certain than week 7');
  assert.equal(blendWeight(null), 0);
  assert.equal(blendWeight(-2), 0);
});

test('at no games the board IS the preseason market', () => {
  assert.equal(blendRank(10, 90, 0, 300), 10);
});

test('at one game the market still holds the board and the season nudges it', () => {
  // 5/6 of 10 plus 1/6 of 40 = 15.
  assert.equal(blendRank(10, 40, 1, 300), 15);
});

test('at six games the board IS the season, and the market is gone', () => {
  assert.equal(blendRank(10, 40, 6, 300), 40);
  assert.equal(blendRank(10, 40, 17, 300), 40);
});

test('one missing input takes the back of the board for that side, not a verdict', () => {
  // Priced by nobody, but he has played six: his VOR rank is the whole answer.
  assert.equal(blendRank(null, 12, 6, 300), 12);
  // Priced in August, never played: the market is the whole answer.
  assert.equal(blendRank(44, null, 0, 300), 44);
  // Priced by nobody and never played: last, and still on the board.
  assert.equal(blendRank(null, null, 0, 300), Infinity);
});

// ---------------------------------------------------------------------------
// 4. THE ORDER: K AND DST BELOW EVERY SKILL PLAYER
// ---------------------------------------------------------------------------
const row = (o) => ({ name: o.name, position: o.position, ppg: o.ppg ?? null, vor: o.vor ?? null,
  priorRank: o.priorRank ?? null, games: o.games ?? 0 });

test('every kicker and defense sits below every skill player, ordered by ppg', () => {
  const board = orderBoard([
    row({ name: 'Big Kicker', position: 'PK', ppg: 14 }),
    row({ name: 'Best Defense', position: 'DEF', ppg: 12 }),
    row({ name: 'A Back', position: 'RB', ppg: 22, vor: 11, priorRank: 1, games: 6 }),
    row({ name: 'A Worse Back', position: 'RB', ppg: 4, vor: -7, priorRank: 200, games: 6 }),
    row({ name: 'Small Kicker', position: 'PK', ppg: 6 }),
  ]);
  assert.deepEqual(board.map((r) => r.name),
    ['A Back', 'A Worse Back', 'Big Kicker', 'Best Defense', 'Small Kicker']);
  // Even the worst skill player outranks the best kicker: they are not on the
  // same value scale and the ranked roster has no slot for one.
  const lastSkill = board.findIndex((r) => r.name === 'A Worse Back');
  const firstNon = board.findIndex((r) => r.position === 'PK');
  assert.ok(lastSkill < firstNon);
});

test('the board rank is the row number, and it is what adp carries', () => {
  const board = orderBoard([
    row({ name: 'Second', position: 'WR', ppg: 15, vor: 4, priorRank: 2, games: 0 }),
    row({ name: 'First', position: 'WR', ppg: 20, vor: 9, priorRank: 1, games: 0 }),
  ]);
  assert.deepEqual(board.map((r) => [r.name, r.boardRank, r.adp]), [['First', 1, 1], ['Second', 2, 2]]);
});

test('a man with no prior and no games ranks last and is still on the board', () => {
  const board = orderBoard([
    row({ name: 'Unknown', position: 'WR' }),
    row({ name: 'Known', position: 'WR', ppg: 15, vor: 4, priorRank: 1, games: 0 }),
  ]);
  assert.deepEqual(board.map((r) => r.name), ['Known', 'Unknown']);
  assert.equal(board.length, 2, 'last is not the same as gone - he is searchable');
});

test('six games of evidence can overtake the market, and one game cannot', () => {
  const mk = (games) => orderBoard([
    // Priced 1st in August, replacement-level since.
    row({ name: 'August Darling', position: 'RB', ppg: 9, vor: -2, priorRank: 1, games }),
    // Priced 30th in August, the best player in football since.
    row({ name: 'September Man', position: 'RB', ppg: 24, vor: 13, priorRank: 30, games }),
  ]).map((r) => r.name);
  assert.deepEqual(mk(1), ['August Darling', 'September Man'], 'one Sunday does not move a market');
  assert.deepEqual(mk(6), ['September Man', 'August Darling'], 'six do');
});

// ---------------------------------------------------------------------------
// 5. THE ROW SHAPE THE ROOM ALREADY CONSUMES
// ---------------------------------------------------------------------------
test('a board row is mapPoolRow shaped, plus vor and ppg', () => {
  const r = boardRow({
    ffcPlayerId: '5672', name: 'Jahmyr Gibbs', position: 'RB', team: 'DET', bye: 6,
    adp: 1, league: 'nfl', ncaafAdp: null, rookie: false, vor: 11.1, ppg: 22.3,
  });
  assert.deepEqual(Object.keys(r).sort(), [
    'adp', 'adpHigh', 'adpLow', 'bye', 'ffcPlayerId', 'league', 'name', 'ncaafAdp',
    'position', 'ppg', 'rookie', 'stdev', 'team', 'timesDrafted', 'vor',
  ]);
  assert.equal(r.adp, 1, 'adp carries the board rank, in overall-pick units');
  assert.equal(r.adpHigh, null);
  assert.equal(r.adpLow, null);
  assert.equal(r.stdev, null, 'no measured spread is asserted - the engine has a path for that');
  assert.equal(r.timesDrafted, null);
  assert.equal(r.vor, 11.1);
  assert.equal(r.ppg, 22.3);
});

test('the shape matches what mapPoolRow emits, key for key', () => {
  const src = readFileSync(new URL('../fantasy/drafts.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function mapPoolRow'), src.indexOf('// SOURCE IS NOW PART OF EVERY POOL READ'));
  for (const key of ['ffcPlayerId', 'name', 'position', 'team', 'adp', 'adpHigh', 'adpLow',
    'timesDrafted', 'stdev', 'bye', 'league', 'ncaafAdp', 'rookie']) {
    assert.ok(fn.includes(`${key}:`), `mapPoolRow still emits ${key} - the board must too`);
  }
});

// ---------------------------------------------------------------------------
// 6. THE WIRING: one reload path, one provenance stamp
// ---------------------------------------------------------------------------
test('every pool reload goes through poolFor, so no reader can load the wrong board', () => {
  const src = readFileSync(new URL('../fantasy/drafts.js', import.meta.url), 'utf8');
  // Exactly one getPoolAt(draft...) survives, and it is the one INSIDE poolFor
  // - the FFC branch. Any other would load an FFC snapshot for a room drafting
  // our board, and rebuildState would throw on the next load.
  const poolForFn = src.slice(src.indexOf('export async function poolFor'),
    src.indexOf('// Distinct (scoring_format, teams_count) pairs'));
  assert.equal((src.match(/getPoolAt\(draft\./g) ?? []).length, 1);
  assert.equal((poolForFn.match(/getPoolAt\(draft\./g) ?? []).length, 1,
    'the only one is poolFor\'s own FFC branch');
  assert.ok(src.includes('export async function poolFor(draft, config)'));
  assert.equal((src.match(/await poolFor\(draft, config\)/g) ?? []).length, 5,
    'all five reload sites route through it');
});

test('the provenance stamp is a value in pool_source, and only poolFor branches on it', () => {
  assert.equal(OUR_SOURCE, 'sportsvyn');
  const src = readFileSync(new URL('../fantasy/drafts.js', import.meta.url), 'utf8');
  assert.ok(src.includes("if (source !== OUR_SOURCE)"), 'poolFor branches on the stamp');
});

test('the room is told whose board it is, and the label names the season', () => {
  const src = readFileSync(new URL('../fantasy/drafts.js', import.meta.url), 'utf8');
  assert.match(src, /boardLabel: \(draft\.pool_source \?\? 'ffc'\) === OUR_SOURCE/);
  assert.match(src, /Sportsvyn board · \$\{resolveSeasonYear/);
  const room = readFileSync(new URL('../../components/sim/DraftRoom.js', import.meta.url), 'utf8');
  assert.ok(room.includes('poolMapping?.boardLabel'), 'the room prints the label it is given');
  // And no season is TYPED in the room - the label arrives already made. (The
  // word SEASON appears in a comment about the college PPG stamp, which is why
  // this looks for a four-digit year rather than for the word.)
  const code = room
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')          // JSX comment blocks
    .replace(/\/\*[\s\S]*?\*\//g, '')                // block comments
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /\b20[0-9]{2}\b/, 'no year is typed into the room');
});

// ---------------------------------------------------------------------------
// 7. THE BOARD THE REAL CORPUS PRODUCES
// ---------------------------------------------------------------------------
// THIS IS THE TEST THE READER ASKED FOR, and it is the only one a fixture
// cannot stand in for. The complaint was not "the arithmetic is wrong", it was
// "not a lot of QBs should go before the RBs and WRs" - a claim about what
// comes out the far end of the whole pipeline: this corpus, this prior, these
// replacement ranks, this blend.
//
// WHAT IT PINS AND WHAT IT DOES NOT. It pins the PROPERTY (at most one
// quarterback in the first two rounds, and never one at 1.01), never a
// position for a named man - because the blend is designed to MOVE him as the
// season accumulates. Josh Allen sits at 29 in week 2 on a weight of 1/6 and
// will climb toward his VOR rank of 13 as the weight reaches 1 around week 7.
// A test that pinned "Allen at 16" would be a test that goes red every week
// the design works correctly.
import { ourBoard } from './ourBoard.js';
import { DRAFT_CONFIG } from './contest.js';
import { resolveSeasonYear } from '../pollers/seasonResolver.js';

test('the real board puts backs and receivers in front of quarterbacks', async () => {
  const board = await ourBoard({
    scoringFormat: DRAFT_CONFIG.scoringFormat,
    teamsCount: DRAFT_CONFIG.teamsCount,
    rosterSlots: DRAFT_CONFIG.rosterSlots,
    season: resolveSeasonYear(new Date()),
  });
  assert.ok(board.rows.length >= 96,
    `a 12x8 room needs 96 real picks; the board carries ${board.rows.length}`);

  const topTwoRounds = board.rows.slice(0, DRAFT_CONFIG.teamsCount * 2);
  const qbs = topTwoRounds.filter((r) => r.position === 'QB');
  assert.ok(qbs.length <= 1,
    `at most one QB in the first two rounds; found ${qbs.length}: ${qbs.map((q) => q.name).join(', ')}`);
  assert.notEqual(board.rows[0].position, 'QB', 'and never one at 1.01');

  const skillTop = topTwoRounds.filter((r) => ['RB', 'WR'].includes(r.position));
  assert.ok(skillTop.length >= 18,
    `the first two rounds are backs and receivers; found ${skillTop.length} of ${topTwoRounds.length}`);
});

test('the real board seats a ranked room, bottom to top', async () => {
  const board = await ourBoard({
    scoringFormat: DRAFT_CONFIG.scoringFormat,
    teamsCount: DRAFT_CONFIG.teamsCount,
    rosterSlots: DRAFT_CONFIG.rosterSlots,
    season: resolveSeasonYear(new Date()),
  });
  const SKILLPOS = ['QB', 'RB', 'WR', 'TE'];
  const draftable = board.rows.filter((r) => SKILLPOS.includes(r.position));
  assert.ok(draftable.length >= DRAFT_CONFIG.teamsCount * 8,
    `${draftable.length} draftable rows against a 96-pick demand`);

  // K and DST below every skill player, on the real data as on the fixture.
  const lastSkill = board.rows.map((r) => SKILLPOS.includes(r.position)).lastIndexOf(true);
  const firstOther = board.rows.findIndex((r) => !SKILLPOS.includes(r.position));
  if (firstOther !== -1) assert.ok(lastSkill < firstOther, 'no kicker outranks a skill player');

  // adp is a dense 1..N rank, which is what valueGap and adp_at_pick read.
  board.rows.forEach((r, i) => assert.equal(r.adp, i + 1));
  assert.match(board.label, /^Sportsvyn board · 20\d\d$/);
  assert.ok(board.priorDate, 'the prior is a real preseason snapshot date');
});
