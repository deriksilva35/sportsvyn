// lib/nba/fantasyPoints.test.mjs - the NBA table, pure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NBA_POINTS, RULES_LINE, linePoints, rawPoints, doubleDigitCats, statChips, seasonFppg, nbaLine,
} from './fantasyPoints.js';

test('the table is the ruling, verbatim', () => {
  assert.deepEqual({ ...NBA_POINTS }, { pts: 1, reb: 1.25, ast: 1.5, stl: 2, blk: 2, tov: -0.5, fg3m: 0.5, doubleDouble: 1.5, tripleDouble: 3 });
  // sat-5 S2: the stack is said, exactly.
  assert.equal(RULES_LINE, 'PTS 1 · REB 1.25 · AST 1.5 · STL 2 · BLK 2 · TOV -0.5 · 3PM +0.5 · DD +1.5, TD +3 (stack: +4.5)');
  assert.ok(RULES_LINE.includes('DD +1.5, TD +3 (stack: +4.5)'));
});

test('a plain line: 20 pts, 5 reb, 4 ast, 1 stl, 0 blk, 3 tov, 2 threes', () => {
  // 20 + 6.25 + 6 + 2 + 0 - 1.5 + 1 = 33.75 -> 33.8
  const row = { pts: 20, reb: 5, ast: 4, stl: 1, blk: 0, turnovers: 3, fg3m: 2 };
  assert.equal(rawPoints(row), 33.75);
  assert.equal(linePoints(row), 33.8);
  assert.equal(linePoints({ ...row, turnovers: undefined, turnover: 3 }), 33.8, "BDL's feed spells it turnover");
});

test('double-double +1.5; triple-double stacks +3 on top (4.5)', () => {
  const dd = { pts: 22, reb: 11, ast: 3, stl: 0, blk: 0, turnovers: 0, fg3m: 0 };
  assert.equal(doubleDigitCats(dd), 2);
  assert.equal(rawPoints(dd), 22 + 13.75 + 4.5 + 1.5);
  const td = { pts: 15, reb: 10, ast: 10, stl: 0, blk: 0, turnovers: 0, fg3m: 0 };
  assert.equal(doubleDigitCats(td), 3);
  assert.equal(rawPoints(td), 15 + 12.5 + 15 + 1.5 + 3);
  // Steals and blocks are categories; turnovers and threes are not.
  assert.equal(doubleDigitCats({ pts: 10, stl: 10, turnovers: 12, fg3m: 10 }), 2);
});

test('a DNP row and a missing row are zero', () => {
  assert.equal(linePoints(null), 0);
  assert.equal(linePoints({ dnp: true, pts: null, reb: null }), 0);
  assert.equal(nbaLine({ dnp: true }), 'DNP');
  assert.equal(nbaLine({ pts: 28, reb: 9, ast: 0, stl: 2 }), '28 PTS · 9 REB · 2 STL');
});

test('chips: one per stat with its points, DD or TD once earned', () => {
  const chips = statChips({ pts: 15, reb: 10, ast: 10, stl: 1, blk: 0, turnovers: 4, fg3m: 1 });
  assert.deepEqual(chips.map((c) => c.key), ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'fg3m', 'td']);
  assert.deepEqual(chips.find((c) => c.key === 'tov'), { key: 'tov', label: 'TOV', count: 4, points: -2 });
  assert.equal(chips.find((c) => c.key === 'td').points, 4.5);
  assert.equal(chips.reduce((a, c) => a + c.points, 0), rawPoints({ pts: 15, reb: 10, ast: 10, stl: 1, blk: 0, turnovers: 4, fg3m: 1 }),
    'the chips sum to the line');
  assert.equal(statChips({ pts: 22, reb: 11 }).at(-1).key, 'dd');
});

test('season FP/G: per-game averages through the table, bonuses at their per-game rate', () => {
  // Curry 2025-26, as BDL sent it on 1 Oct 2026.
  const s = { gp: 43, pts: 26.6, reb: 3.6, ast: 4.7, stl: 1.1, blk: 0.4, tov: 2.8, fg3m: 4.4, dd2: 3, td3: 0 };
  const want = 26.6 + 3.6 * 1.25 + 4.7 * 1.5 + 1.1 * 2 + 0.4 * 2 - 2.8 * 0.5 + 4.4 * 0.5 + (3 * 1.5) / 43;
  assert.equal(seasonFppg(s), Math.round(want * 10) / 10);
  assert.equal(seasonFppg({ gp: 0, pts: 10 }), null);
  assert.equal(seasonFppg(null), null);
});
