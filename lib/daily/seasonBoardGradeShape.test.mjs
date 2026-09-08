// lib/daily/seasonBoardGradeShape.test.mjs - the stored best roster grades
// correctly, and the two halves of an edition can never be shaped apart again.
//
// THE DEFECT, from the first submitted v2 run (8 Sep 2026, PROD row 1): every
// slot MISSED, Cam Newton paired against himself, "0 of 8 matched" beside
// "90% of ceiling", and a story reading "undefined (CAR)". daily_boards.board
// was stored through shapeTeams() (name, meta); daily_boards.best_roster was
// JSON.stringify(optimum.bySlot) raw off the solver (raw_name, team_key, no
// meta). gradeFromOptimum read b.player.name off the second and got undefined
// eight times, so the name comparison that decides MATCHED never fired.
//
// HERMETIC AND REAL: the fixture is PROD board 2 captured AS STORED - raw
// shape and all - plus the exact eight picks that were graded wrong. No
// database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { regradeStoredRun } from './seasonBoardRuns.js';
import { shapeBestRoster, SLOTS } from './boardShape.js';
import { boardStory } from './seasonBoardGrade.js';
import { buildEditionHalves } from './seasonBoardEditions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FX = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'board-2026-09-08.json'), 'utf8'));
const board = { id: FX.board_id, ceiling: FX.ceiling, board: FX.board, best_roster: FX.best_roster };

test('the fixture really is the raw shape - otherwise this file tests nothing', () => {
  const b0 = FX.best_roster[0];
  assert.ok(b0.player, 'nested player object');
  assert.equal(b0.player.raw_name, 'Cam Newton');
  assert.equal(b0.player.name, undefined, 'no normalised name on the stored row');
  assert.equal(b0.player.meta, undefined);
});

test("4a. Derik's exact picks grade to FOUR matched, not zero", () => {
  const r = regradeStoredRun(board, FX.picks, SLOTS);
  assert.equal(r.ok, true);
  const g = r.grade;
  const hits = g.rows.filter((x) => x.hit).map((x) => x.you.name).sort();
  assert.deepEqual(hits, ['Cam Newton', 'Darren McFadden', 'Demaryius Thomas', 'Larry Fitzgerald'].sort());
  assert.equal(g.matchedCount, 4);
  // The points path was always right; it must not have moved.
  assert.equal(g.mine, 1840.2);
  assert.equal(g.perfect, 2039.4);
  assert.equal(g.pct, 90);
  // Every best-roster cell now carries a name and a meta line.
  for (const row of g.rows) {
    assert.equal(typeof row.best.name, 'string', `best name missing at slot ${row.you.slot}`);
    assert.equal(typeof row.best.meta, 'string', `best meta missing at slot ${row.you.slot}`);
  }
  // Slot 0: Cam Newton against Cam Newton is a HIT, not a MISS.
  assert.equal(g.rows[0].you.name, 'Cam Newton');
  assert.equal(g.rows[0].best.name, 'Cam Newton');
  assert.equal(g.rows[0].hit, true);
  assert.equal(g.glyph.match(/🟩/gu).length, 4);
});

test('4a. the story names a real player, never "undefined"', () => {
  const { grade, play } = regradeStoredRun(board, FX.picks, SLOTS);
  const story = boardStory(grade, play.used.length, FX.board.length, '31:28');
  assert.doesNotMatch(story, /undefined/);
  // The biggest name left is DeAndre Hopkins (HOU, 329.1) - the highest-
  // scoring best-roster player Derik did not take.
  assert.match(story, /DeAndre Hopkins \(HOU\), worth 329\.1/);
});

test('the receipt play object has the shape initBoardPlay returns, and used is an array', () => {
  const { play } = regradeStoredRun(board, FX.picks, SLOTS);
  assert.deepEqual(Object.keys(play).sort(), ['roster', 'slots', 'teams', 'used']);
  assert.equal(play.teams, FX.board, 'teams is the board itself - teamsLeft() filters it on every render');
  assert.ok(Array.isArray(play.used), 'used must cross the RSC boundary, and a Set cannot');
  assert.equal(play.used.length, 8);
  // And it survives the boundary: JSON round-trip is what RSC does to it.
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(play)));
});

test('shapeBestRoster is idempotent across all three input shapes', () => {
  const raw = FX.best_roster;
  const flat = shapeBestRoster(raw);
  assert.deepEqual(shapeBestRoster(flat), flat, 'flat in -> same flat out');
  // Solver over SHAPED cards (the client practice path): player has name+meta.
  const shapedSolver = raw.map((b) => ({ slot: b.slot, teamKey: b.teamKey,
    player: { name: b.player.raw_name, meta: 'x', points: b.player.points, position: b.player.position } }));
  const fromShaped = shapeBestRoster(shapedSolver);
  assert.equal(fromShaped[0].name, 'Cam Newton');
  assert.equal(fromShaped[0].meta, 'x', 'an existing meta is kept, not recomputed');
  for (const e of flat) {
    assert.deepEqual(Object.keys(e).sort(), ['abbr', 'meta', 'name', 'points', 'position', 'slot', 'teamKey']);
    assert.equal(typeof e.name, 'string');
  }
});

test('4c. board and best_roster are written in ONE shape, from one function', () => {
  // Drive the write path's own value builder with the fixture's raw inputs:
  // the solver's raw bySlot as `optimum`, and raw season rows as `teams`
  // (reconstructed from best_roster's players, which are raw rows).
  const rawTeams = FX.best_roster.map((b) => ({ key: b.teamKey, card: [b.player] }));
  const halves = buildEditionHalves(rawTeams, { total: FX.ceiling, bySlot: FX.best_roster });

  const cardKeys = Object.keys(halves.board[0].card[0]).sort();
  const bestKeys = Object.keys(halves.best_roster[0]).sort();
  // Every key a board CARD carries, a best-roster entry carries too.
  for (const k of cardKeys) assert.ok(bestKeys.includes(k), `best_roster is missing card key "${k}"`);
  // And nothing raw leaks into either half.
  const leak = JSON.stringify(halves);
  assert.doesNotMatch(leak, /raw_name|team_key|"player":/, 'a raw solver field reached the INSERT');
  // Same player, same name, same meta on both sides.
  assert.equal(halves.board[0].card[0].name, halves.best_roster[0].name);
  assert.equal(halves.board[0].card[0].meta, halves.best_roster[0].meta);
});

test('4c. the INSERT takes both halves from buildEditionHalves and nowhere else', () => {
  const src = readFileSync(path.join(__dirname, 'seasonBoardEditions.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const insert = src.slice(src.indexOf('INSERT INTO daily_boards'), src.indexOf('ON CONFLICT (edition_date)'));
  assert.match(insert, /JSON\.stringify\(halves\.board\)/);
  assert.match(insert, /JSON\.stringify\(halves\.best_roster\)/);
  assert.doesNotMatch(insert, /optimum\.bySlot|shapeTeams\(/, 'a half is being shaped inline again');
});

test('the alignment never throws on a label move that has no legal completion', () => {
  // Derik's own board: Fitzgerald held at FLEX, best roster has him at WR with
  // Jordan Reed (TE) at FLEX. The old pairwise swap threw "illegal
  // permutation: Larry Fitzgerald (WR) -> FLEX, Jordan Reed (TE) -> WR" here,
  // the first time it ever ran with real names.
  const { grade } = regradeStoredRun(board, FX.picks, SLOTS);
  const fitz = grade.rows.find((r) => r.you.name === 'Larry Fitzgerald');
  assert.equal(fitz.hit, true);
  assert.equal(fitz.best.name, 'Larry Fitzgerald');
  assert.equal(fitz.moved, 'FLEX', 'held at FLEX, best roster had him at WR - the note fires');
  // Every best entry appears exactly once across the rows - nothing lost,
  // nothing duplicated by the alignment.
  const names = grade.rows.map((r) => r.best.name).sort();
  assert.deepEqual(names, FX.best_roster.map((b) => b.player.raw_name).sort());
});
