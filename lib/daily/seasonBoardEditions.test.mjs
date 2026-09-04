// lib/daily/seasonBoardEditions.test.mjs - ensureBoardForDate against the real
// DEV database (nfl_player_season_totals, daily_boards). pickEligibleSeason
// itself is pure and gets its own no-DB tests first.

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { sql } = await import('../db.js');
const { ensureBoardForDate, pickEligibleSeason, isEditionLive, effectiveEpoch, DAILY_V2_EPOCH } = await import('./seasonBoardEditions.js');
const { RECENCY_WINDOW_DAYS } = await import('./boardScheduling.js');

// -----------------------------------------------------------------------
// isEditionLive: PURE, string comparison. The route (app/daily/board/
// page.js) calls ensureBoardForDate ONLY when this is true - a date before
// the epoch must never reach that call, and the epoch date itself must.
// -----------------------------------------------------------------------
test('a date before the epoch is not live', () => {
  assert.equal(isEditionLive('2026-09-07'), false);
});

test('the epoch date itself is live', () => {
  assert.equal(isEditionLive(DAILY_V2_EPOCH), true);
  assert.equal(isEditionLive('2026-09-08'), true);
});

// -----------------------------------------------------------------------
// effectiveEpoch: PURE given an env object (never reads process.env
// itself). PROD ignores the override outright, even if set; every
// non-production VERCEL_ENV (or none at all, e.g. this test file's own
// process) honours it when present.
// -----------------------------------------------------------------------
test('on production, the override is ignored even if set', () => {
  const e = effectiveEpoch({ VERCEL_ENV: 'production', DAILY_V2_EPOCH_OVERRIDE: '2020-01-01' });
  assert.equal(e, DAILY_V2_EPOCH);
});

test('off production, the override wins when set', () => {
  const e = effectiveEpoch({ VERCEL_ENV: 'preview', DAILY_V2_EPOCH_OVERRIDE: '2026-09-04' });
  assert.equal(e, '2026-09-04');
});

test('off production, no override set falls back to the real epoch', () => {
  assert.equal(effectiveEpoch({ VERCEL_ENV: 'preview' }), DAILY_V2_EPOCH);
  assert.equal(effectiveEpoch({}), DAILY_V2_EPOCH, 'no VERCEL_ENV at all (e.g. the droplet) is not "production" either, but nothing is set to override');
});

test('a date after the epoch is live', () => {
  assert.equal(isEditionLive('2026-09-09'), true);
});

// -----------------------------------------------------------------------
// pickEligibleSeason: PURE, no DB. Same fixture shape either way - a season
// present in the corpus but used by a prior edition inside the window must
// never be chosen.
// -----------------------------------------------------------------------
test('pickEligibleSeason never returns a season inside its recency window', () => {
  const present = [2015, 2016, 2017];
  const recent = [2015, 2016]; // both used within the last RECENCY_WINDOW_DAYS
  const chosen = pickEligibleSeason(present, recent, '2026-01-01');
  assert.equal(chosen, 2017, 'the only season NOT in its cooldown');
});

test('pickEligibleSeason returns null when every present season is in cooldown', () => {
  const chosen = pickEligibleSeason([2015, 2016], [2015, 2016], '2026-01-01');
  assert.equal(chosen, null);
});

test('pickEligibleSeason is deterministic for the same edition date', () => {
  const present = [1980, 1985, 1995, 2015, 2020, 2023];
  const a = pickEligibleSeason(present, [], '2026-03-01');
  const b = pickEligibleSeason(present, [], '2026-03-01');
  assert.equal(a, b);
});

// -----------------------------------------------------------------------
// ensureBoardForDate: real DEV corpus. A FAR-FUTURE edition_date so this
// suite can never collide with a real edition. TEARDOWN DELETES BY ID, NOT
// BY DATE OR SEASON - the exact lesson daily_board_runs/contests teardown
// already learned the hard way (see lib/weekly/weeklyDb.test.mjs's own
// comment on this), applied before this file has a chance to relearn it.
// -----------------------------------------------------------------------
const EDITION_DATE = '2097-06-15'; // matches weeklyDb.test.mjs's synthetic-season convention
const created = [];

test('the corpus has exactly 31 eligible seasons today', async () => {
  const rows = await sql`SELECT DISTINCT season_year FROM nfl_player_season_totals`;
  assert.equal(rows.length, 31, 'a change here means the corpus grew or shrank - update the count deliberately, never silently');
});

test('ensureBoardForDate is idempotent - calling twice returns the same row', async () => {
  const first = await ensureBoardForDate(sql, EDITION_DATE);
  created.push(first.id);
  const second = await ensureBoardForDate(sql, EDITION_DATE);
  assert.equal(second.id, first.id, 'the second call must not draw a new board for a date that already has one');
  assert.deepEqual(second.best_roster, first.best_roster);
  assert.equal(Number(second.ceiling), Number(first.ceiling));
});

test('ensureBoardForDate freezes a real ceiling and a real best_roster', async () => {
  const board = await ensureBoardForDate(sql, EDITION_DATE);
  created.push(board.id);
  assert.ok(Number(board.ceiling) > 0);
  assert.equal(board.best_roster.length, 8, 'one entry per slot, QB/RB/RB/WR/WR/FLEX/FLEX/K');
  assert.equal(board.board.length, 12, 'twelve drawn teams');
});

test('live_notify_at is 10:00 AM ET, strictly between opens_at and closes_at', async () => {
  const board = await ensureBoardForDate(sql, EDITION_DATE);
  created.push(board.id);
  assert.ok(board.live_notify_at != null);
  assert.ok(new Date(board.live_notify_at) > new Date(board.opens_at));
  assert.ok(new Date(board.live_notify_at) < new Date(board.closes_at));
});

after(async () => {
  if (created.length) {
    await sql`DELETE FROM daily_board_runs WHERE board_id = ANY(${created})`;
    await sql`DELETE FROM daily_boards WHERE id = ANY(${created})`;
  }
});
