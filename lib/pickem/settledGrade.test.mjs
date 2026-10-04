// lib/pickem/settledGrade.test.mjs - PURE, no DB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickemGradeRows, fadedFavourites, pickemMathline, pickemGlyphRow, NOBODY_COPY } from './settledGrade.js';

const rows = [
  // right: picked home, home won
  { match_id: 1, status: 'final', my_side: 'home', graded: 'W', home: 'Kansas St.', away: 'Arizona', home_score: 31, away_score: 20, home_rank: null, away_rank: null },
  // wrong: picked the ranked favourite (home #4), away (#7) won - an upset
  { match_id: 2, status: 'final', my_side: 'home', graded: 'L', home: 'Oklahoma', away: 'Michigan', home_score: 21, away_score: 24, home_rank: 4, away_rank: 7 },
  // right, no rank involved
  { match_id: 3, status: 'final', my_side: 'away', graded: 'W', home: 'San Jose St.', away: 'Texas', home_score: 10, away_score: 45, home_rank: null, away_rank: 1 },
  // tie: a final with no winner, still picked (ruling P4: counts for nobody)
  { match_id: 4, status: 'final', my_side: 'home', graded: null, home: 'Utah', away: 'Wyoming', home_score: null, away_score: null, home_rank: null, away_rank: null },
  // no pick at all - excluded from grade rows entirely
  { match_id: 5, status: 'final', my_side: null, graded: null, home: 'A', away: 'B', home_score: 1, away_score: 0, home_rank: null, away_rank: null },
  // an upset you did NOT pick the favourite in (picked the winner)
  { match_id: 6, status: 'final', my_side: 'away', graded: 'W', home: 'Georgia', away: 'Tennessee', home_score: 24, away_score: 27, home_rank: 3, away_rank: 12 },
];

test('pickemGradeRows: one row per PICKED game, no-pick excluded', () => {
  const g = pickemGradeRows(rows);
  assert.equal(g.length, 5, 'match 5 (no pick) is excluded');
  assert.deepEqual(g.map((r) => r.verdict), ['right', 'wrong', 'right', 'tie', 'right']);
});

test('the winner line names both teams and the score', () => {
  const g = pickemGradeRows(rows);
  assert.equal(g[0].winner, 'Kansas St.');
  assert.equal(g[0].winnerScore, 'Kansas St. 31-20 Arizona');
  assert.equal(g[3].winner, null, 'a push names no winner');
});

test('fadedFavourites: two ranked favourites lost on this board, you had one of them', () => {
  const { faded, hadThem } = fadedFavourites(rows);
  // match 2: #4 Oklahoma (home, better rank) favoured, lost to #7 Michigan -> upset, you picked Oklahoma (favourite) -> hadThem+1
  // match 6: #3 Georgia (home, better rank) favoured, lost to #12 Tennessee -> upset, you picked away (Tennessee, the winner) -> not counted
  assert.equal(faded, 2);
  assert.equal(hadThem, 1);
});

test('pickemMathline tallies right/wrong/tie/void over the graded rows only', () => {
  const g = pickemGradeRows(rows);
  assert.deepEqual(pickemMathline(g), { right: 3, wrong: 1, tie: 1, void: 0 });
});

test('pickemGlyphRow: one glyph per graded row, in row order', () => {
  const g = pickemGradeRows(rows);
  assert.equal(pickemGlyphRow(g), '🟩⬛🟩⬜🟩');
});

// ---- rulings P4 and 2 (sat-5): a tie and a void count for nobody ----------
test('P4: a tied final is a tie - plain words, the score shown, no winner', () => {
  const [r] = pickemGradeRows([{ match_id: 9, status: 'final', my_side: 'away', graded: null,
    home: 'Jets', away: 'Bills', home_score: 20, away_score: 20 }]);
  assert.equal(r.verdict, 'tie');
  assert.equal(r.winner, null);
  assert.equal(r.winnerScore, 'Jets 20-20 Bills');
  assert.equal(NOBODY_COPY.tie, 'Tie - no winner, counts for nobody');
});

test('ruling 2: a picked game the board settled without is void', () => {
  const g = pickemGradeRows([
    { match_id: 10, status: 'postponed', my_side: 'home', graded: null, home: 'A', away: 'B', home_score: null, away_score: null },
    { match_id: 11, status: 'final', my_side: 'home', graded: 'W', home: 'C', away: 'D', home_score: 2, away_score: 1 },
  ]);
  assert.deepEqual(g.map((r) => r.verdict), ['void', 'right']);
  assert.deepEqual(pickemMathline(g), { right: 1, wrong: 0, tie: 0, void: 1 });
  assert.equal(pickemGlyphRow(g), '⬜🟩');
});

test('the grade card counts a tie and a void OUT of played, and never says push', async () => {
  const { readFileSync } = await import('node:fs');
  const t = readFileSync(new URL('../../components/pickem/PickemGrade.js', import.meta.url), 'utf8');
  assert.match(t, /const played = right \+ wrong;/);
  assert.match(t, /tied, counted for nobody/);
  assert.match(t, /void, counted for nobody/);
  assert.doesNotMatch(t, /'Push'|\} push/, 'the push label is gone');
});
