// lib/weekly/live.test.mjs - the lock-to-settle window's running sum.
//
// The pure core (liveEntryRows) is exercised directly; the scoring pieces it
// composes (poolWithScores, bestBall) have their own suites - what THIS suite
// pins is the window's three laws: live is a SUM (no drop-worst), played and
// not-yet-kicked-off are different facts, and the Draft's live six is best
// ball over LIVE scores.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// live.js reaches lib/db.js at module load (through settle's sql import), so
// the env must exist before the import - the preset.test.mjs pattern.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const line2 = line.trim(); if (!line2 || line2.startsWith('#')) continue;
    const eq = line2.indexOf('='); if (eq < 0) continue;
    const k = line2.slice(0, eq).trim(); let v = line2.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { liveEntryRows } = await import('./live.js');
const { SLOTS } = await import('./rules.js');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// A scored board: six starters with known points plus spares.
const P = (id, pos, points) => ({ id, name: `P${id}`, pos, team: 'T', points });
const SCORED = [
  P('qb1', 'QB', 20), P('rb1', 'RB', 10), P('wr1', 'WR', 15), P('te1', 'TE', 5),
  P('fx1', 'RB', 8), P('fx2', 'WR', 0), P('rb2', 'RB', 12), P('wr2', 'WR', 22),
];
const LINEUP = { QB: 'qb1', RB: 'rb1', WR: 'wr1', TE: 'te1', FLEX: 'fx1', FLEX2: 'fx2' };
const PLAYED = new Set(['qb1', 'rb1', 'wr1']);

test('live total is the SUM of all six - drop-worst never applies mid-window', () => {
  const v = liveEntryRows({ lineup: LINEUP, scored: SCORED, playedIds: PLAYED });
  assert.equal(v.total, 58, '20+10+15+5+8+0 - nothing dropped');
  assert.equal(v.rows.length, SLOTS.length);
});

test('played distinguishes "0.0 and done" from "has not kicked off"', () => {
  const v = liveEntryRows({ lineup: LINEUP, scored: SCORED, playedIds: new Set(['fx2']) });
  const fx2 = v.rows.find((r) => r.slot === 'FLEX2');
  const qb = v.rows.find((r) => r.slot === 'QB');
  assert.equal(fx2.played, true, 'a zero from a finished game is a fact');
  assert.equal(fx2.points, 0);
  assert.equal(qb.played, false, 'twenty projected-nothing: he has not played');
  assert.equal(v.playedCount, 1);
});

test('a half-filled lineup sums what exists - live passes no DNF judgment', () => {
  const v = liveEntryRows({ lineup: { QB: 'qb1', RB: 'rb1' }, scored: SCORED, playedIds: PLAYED });
  assert.equal(v.total, 30);
  assert.equal(v.slots, 2, 'and reports how many slots are real');
});

test('a Draft roster goes through best ball over LIVE scores', () => {
  // Roster of 8; live best-6 must pick wr2 (22) and rb2 (12) over te1 (5)
  // and fx2 (0) wherever the grammar allows.
  const roster = ['qb1', 'rb1', 'wr1', 'te1', 'fx1', 'fx2', 'rb2', 'wr2']
    .map((id) => ({ id, pos: SCORED.find((p) => p.id === id).pos, name: id }));
  const v = liveEntryRows({ roster, scored: SCORED, playedIds: PLAYED });
  // best six by the lineup grammar: QB qb1(20), RB rb2(12), WR wr2(22),
  // TE te1(5, only TE), FLEX rb1(10)/wr1(15) -> the two best remaining
  assert.equal(v.total, 20 + 12 + 22 + 5 + 15 + 10);
  const ids = new Set(v.rows.map((r) => r.id));
  assert.ok(!ids.has('fx2'), 'the zero sits on the live bench');
});

test('roster takes precedence over lineup when both ride in', () => {
  const roster = [{ id: 'wr2', pos: 'WR', name: 'wr2' }];
  const v = liveEntryRows({ lineup: LINEUP, roster, scored: SCORED, playedIds: PLAYED });
  assert.ok(v.rows.some((r) => r.id === 'wr2'), 'the Draft entry is its roster');
});

test('determinism: identical inputs, identical output', () => {
  const a = liveEntryRows({ lineup: LINEUP, scored: SCORED, playedIds: PLAYED });
  const b = liveEntryRows({ lineup: LINEUP, scored: SCORED, playedIds: PLAYED });
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// the wire shapes - the leak law's clauses for this window
// ---------------------------------------------------------------------------

test('the live board never selects lineups onto the wire', () => {
  const t = stripComments(src('lib/weekly/live.js'));
  const board = t.slice(t.indexOf('export async function liveBoard'));
  // The read pulls lineup to SCORE it; the returned rows must carry only
  // rank / userId / name / total / played.
  assert.match(board, /return \{ userId: e\.user_id, name: displayName/);
  assert.ok(!/lineup/.test(board.slice(board.indexOf('return {'), board.indexOf('};'))),
    'a lineup key on a board row is a leak');
});

test('the lobby table is null pre-lock - sealed entries never wear zeros', () => {
  const t = stripComments(src('lib/weekly/live.js'));
  const fn = t.slice(t.indexOf('export async function weeklyBoardTable'));
  const gate = fn.indexOf('if (!locked) return null');
  const reads = fn.indexOf('contest_entries');
  assert.ok(gate > -1 && gate < reads, 'the pre-lock null must precede any entry read');
});

test('both locked views label the number honestly - before drop-worst', () => {
  for (const rel of ['app/weekly/page.js', 'app/draft/page.js']) {
    assert.match(src(rel), /before drop-worst/, `${rel} shows a moving number unlabeled`);
  }
});
