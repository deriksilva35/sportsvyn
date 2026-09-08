// lib/daily/seasonBoardStartRow.test.mjs - the attempt is consumed at START.
//
// WHAT BROKE. Until migration 097, daily_board_runs was submit-only: every
// column NOT NULL, so no row could exist before a grade. Start wrote nothing
// at all - startClock() was a signed-in check and SeasonBoard's Start called
// beginTimer() and changed screen. A player could open the board, read all
// twelve team cards, reload, and start again on a fresh client-side clock as
// often as they liked, and the row they finally submitted was indistinguishable
// from a first attempt. The rules card said "One attempt - this board is
// ranked" the whole time.
//
// HERMETIC. Its own board on a 2097 edition date nobody uses, its own sentinel
// user, torn down whole. NEVER a real account and never a real edition - a test
// that seeds a real user's row to prove a write path is how a real row gets
// clobbered.

import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(REPO, '.env.local'));

const { sql } = await import('../db.js');
const { startRun, submitRun } = await import('./seasonBoardRuns.js');
const { SLOTS } = await import('./boardShape.js');

const EDITION = '2097-04-04';
const OPENS = '2097-04-04T04:00:00Z';
const CLOSES = '2097-04-05T04:00:00Z';
const AFTER_CLOSE = '2097-04-05T05:00:00Z';

let boardId = null;
let userId = null;

// A board whose cards are irrelevant to these tests - nothing here grades a
// real roster; the two submit tests drive the refusal paths, which are decided
// before grading ever runs.
const BOARD = [{ key: 'AAA', card: [{ position: 'QB', name: 'Test QB', points: 10 }] }];

before(async () => {
  // No ON CONFLICT: users.email carries no unique constraint on this schema,
  // so an upsert here fails with "no unique or exclusion constraint matching".
  // Delete-then-insert instead, which also guarantees a clean row if a previous
  // run died before its teardown.
  await sql`DELETE FROM users WHERE email = 'startrow-sentinel@example.invalid'`;
  userId = (await sql`
    INSERT INTO users (email, handle) VALUES ('startrow-sentinel@example.invalid', 'startrowsentinel')
    RETURNING id`)[0].id;
  boardId = (await sql`
    INSERT INTO daily_boards (edition_date, season_year, seed, board, ceiling, best_roster, opens_at, closes_at)
    VALUES (${EDITION}, 2097, 'startrow-seed', ${JSON.stringify(BOARD)}::jsonb, 100,
            '[]'::jsonb, ${OPENS}::timestamptz, ${CLOSES}::timestamptz)
    RETURNING id`)[0].id;
});

after(async () => {
  if (boardId) await sql`DELETE FROM daily_board_runs WHERE board_id = ${boardId}`;
  if (boardId) await sql`DELETE FROM daily_boards WHERE id = ${boardId}`;
  if (userId) await sql`DELETE FROM users WHERE id = ${userId}`;
});

test('start writes a row with started_at and NO picks - the attempt is spent', async () => {
  const r = await startRun(sql, { boardId, userId, now: OPENS });
  assert.equal(r.ok, true);
  assert.equal(r.resumed, false, 'the first start is not a resume');
  assert.ok(r.startedAt, 'started_at was stamped');

  const [row] = await sql`SELECT * FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${userId}`;
  assert.ok(row, 'a row exists before any submit');
  assert.equal(row.picks, null, 'started, not submitted');
  assert.equal(row.score, null);
  assert.equal(row.completed_at, null, 'a started run has NOT completed - the old DEFAULT now() would have lied here');
});

test('RELOAD MID-RUN GETS THE SAME DEADLINE, not a fresh clock', async () => {
  const first = await sql`SELECT started_at FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${userId}`;
  // A reload an hour later. If start were not idempotent this would re-stamp.
  const again = await startRun(sql, { boardId, userId, now: '2097-04-04T05:00:00Z' });
  assert.equal(again.ok, true);
  assert.equal(again.resumed, true, 'the second start reports itself a resume');
  assert.equal(
    new Date(again.startedAt).toISOString(),
    new Date(first[0].started_at).toISOString(),
    'the resumed clock is the ORIGINAL instant',
  );
  const rows = await sql`SELECT count(*)::int n FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${userId}`;
  assert.equal(rows[0].n, 1, 'a second start is a no-op, never a second row');
});

test('a started-but-unsubmitted row never appears on a leaderboard', async () => {
  const { todayLeaderboard, playedLeaderboard } = await import('./seasonBoardLeaderboards.js');
  const today = await todayLeaderboard(sql, boardId);
  assert.equal(today.length, 0, 'a started run is not a result');
  const played = await playedLeaderboard(sql);
  assert.equal(played.find((r) => Number(r.userId) === Number(userId)), undefined,
    'a started run does not count as played');
});

test('EVERY read in seasonBoardLeaderboards.js filters on picks IS NOT NULL', () => {
  // Six reads touch daily_board_runs. Grepped rather than trusted, because a
  // seventh added later without the filter would leak started rows into a
  // ranking and no fixture here would catch it.
  const src = readFileSync(path.join(REPO, 'lib/daily/seasonBoardLeaderboards.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const reads = (code.match(/FROM daily_board_runs/g) ?? []).length;
  const filters = (code.match(/picks IS NOT NULL/g) ?? []).length;
  assert.equal(reads, 6, 'expected six reads of daily_board_runs');
  assert.equal(filters, 6, `every read must exclude started rows - ${reads} reads but ${filters} filters`);
});

test('SUBMIT AFTER THE BOARD CLOSES IS REFUSED - it is a DNF, not a late score', async () => {
  const r = await submitRun(sql, {
    boardId, userId, picks: [], elapsedS: 60, slots: SLOTS, now: AFTER_CLOSE,
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'board closed');
  assert.equal(r.status, 409);
  const [row] = await sql`SELECT picks FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${userId}`;
  assert.equal(row.picks, null, 'the started row is untouched by a refused late submit');
});

test('start is refused once the board has closed', async () => {
  const r = await startRun(sql, { boardId, userId: userId, now: AFTER_CLOSE });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'board closed');
});

test('submit without a start is refused as never started, not silently inserted', async () => {
  // A second sentinel with no start row of its own.
  await sql`DELETE FROM users WHERE email = 'startrow-sentinel2@example.invalid'`;
  const other = (await sql`
    INSERT INTO users (email, handle) VALUES ('startrow-sentinel2@example.invalid', 'startrowsentinel2')
    RETURNING id`)[0].id;
  try {
    const r = await submitRun(sql, {
      boardId, userId: other, picks: [], elapsedS: 10, slots: SLOTS, now: OPENS,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'never started');
    const n = await sql`SELECT count(*)::int n FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${other}`;
    assert.equal(n[0].n, 0, 'a refused submit inserts nothing');
  } finally {
    await sql`DELETE FROM daily_board_runs WHERE user_id = ${other}`;
    await sql`DELETE FROM users WHERE id = ${other}`;
  }
});
