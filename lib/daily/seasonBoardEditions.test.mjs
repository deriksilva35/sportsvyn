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
const { ensureBoardForDate, pickEligibleSeason, effectiveWindowDays, isEditionLive, effectiveEpoch, DAILY_V2_EPOCH,
  drawEditionBoard, editionSeeds, seasonTryOrder, DRAW_ATTEMPTS } = await import('./seasonBoardEditions.js');
const { makeRng } = await import('./pool.js');
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

test('season weighting: 2015+ draws roughly 3x as often as older seasons', () => {
  // ONE modern season, ONE old season, evenly matched otherwise - any
  // skew is entirely the weighting. 300 distinct edition dates (no
  // recency window in play - each call is independent) is enough samples
  // for a 3:1 true ratio to land nowhere near 1:1 by chance.
  const present = [1995, 2020];
  let modern = 0; let old = 0;
  for (let i = 0; i < 300; i++) {
    const date = `2030-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`; // distinct seed per i
    const chosen = pickEligibleSeason(present, [], date);
    if (chosen === 2020) modern += 1; else if (chosen === 1995) old += 1;
  }
  assert.equal(modern + old, 300);
  const ratio = modern / old;
  assert.ok(ratio > 2 && ratio < 4, `expected roughly 3:1 (2020:1995), got ${modern}:${old} (ratio ${ratio.toFixed(2)})`);
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

test('the eligible-season count is read from the table at test time, never a hardcoded literal', async () => {
  // NO LITERAL (ruling) - the corpus grows with every backfill relay (31,
  // then 33, and counting), and a hand-typed number here just becomes
  // another line to remember to bump. count(DISTINCT season_year) IS the
  // assertion now, checked against the row-count of the same query written
  // the other way - a real consistency check, not an eyeballed magic number.
  const [{ n }] = await sql`SELECT count(DISTINCT season_year) AS n FROM nfl_player_season_totals`;
  const rows = await sql`SELECT DISTINCT season_year FROM nfl_player_season_totals`;
  assert.equal(rows.length, Number(n), 'DISTINCT row count and count(DISTINCT ...) must agree');
  assert.ok(Number(n) > 0, 'the corpus must have at least one eligible season');
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

// 5 Oct 2026: 24 ranked seasons (2002-2025) and a 30-day cooldown ran dry on
// day 25 - no board, /daily/board 500. The window is capped at seasons - 1.
test('the cooldown never exceeds the pool: a 24-season pool gets a 23-day window, and never runs dry', () => {
  assert.equal(effectiveWindowDays(24), 23);
  assert.equal(effectiveWindowDays(100), RECENCY_WINDOW_DAYS, 'a large pool keeps the full window');
  assert.equal(effectiveWindowDays(1), 0);
  assert.equal(effectiveWindowDays(0), 0);
  const pool = Array.from({ length: 24 }, (_, i) => 2002 + i);
  const w = effectiveWindowDays(pool.length);
  const used = [];
  for (let d = 0; d < 400; d += 1) {
    const date = new Date(Date.UTC(2026, 8, 11) + d * 86400000).toISOString().slice(0, 10);
    const recent = used.slice(-w);
    const s = pickEligibleSeason(pool, recent, date, w);
    assert.notEqual(s, null, `day ${d} (${date}) found a season`);
    assert.ok(!recent.includes(s), `day ${d}: ${s} is outside the ${w}-day window`);
    used.push(s);
  }
});

// -----------------------------------------------------------------------
// mon-5: a failed draw retries fixed alternate seeds before failing the day.
// The stub generator does not know seed strings - it identifies the seed by
// the first value its rng yields, matched against makeRng of each candidate.
// -----------------------------------------------------------------------
const D = '2031-02-03';
const firstDraw = (seed) => makeRng(seed)();
function stubGenerator(okFrom) {
  const seeds = editionSeeds(D);
  const calls = [];
  const generate = (_rows, rng) => {
    const v = rng();
    const i = seeds.findIndex((sd) => firstDraw(sd) === v);
    calls.push(i);
    return i >= okFrom ? { ok: true, teams: [{ key: `T${i}`, card: [] }] } : { ok: false, reason: `stub fail ${i}` };
  };
  return { generate, calls };
}
const okSolve = (teams) => ({ ok: true, total: 1, bySlot: {}, teams });

test('the seed ladder is the primary seed, then #1..#9, fixed', () => {
  const seeds = editionSeeds(D);
  assert.equal(seeds.length, DRAW_ATTEMPTS);
  assert.equal(DRAW_ATTEMPTS, 10);
  assert.equal(seeds[0], `daily-${D}`);
  assert.equal(seeds[3], `daily-${D}#3`);
  assert.equal(seeds[9], `daily-${D}#9`);
});

test('seeds 0-2 fail, seed 3 draws: the #3 board, the #3 seed, deterministically', () => {
  for (let run = 0; run < 2; run += 1) {
    const { generate, calls } = stubGenerator(3);
    const r = drawEditionBoard([], D, { generate, solve: okSolve });
    assert.equal(r.ok, true);
    assert.equal(r.seed, `daily-${D}#3`);
    assert.equal(r.teams[0].key, 'T3');
    assert.deepEqual(calls, [0, 1, 2, 3], 'tried in order and stopped at the first success');
  }
});

test('a draw that solves infeasibly is also retried', () => {
  const { generate } = stubGenerator(0);
  let n = 0;
  const solve = (teams) => (n++ < 2 ? { ok: false, reason: 'no TE' } : okSolve(teams));
  const r = drawEditionBoard([], D, { generate, solve });
  assert.equal(r.seed, `daily-${D}#2`);
});

test('all ten seeds fail: not ok, with every failure listed (the caller throws)', () => {
  const { generate, calls } = stubGenerator(99);
  const r = drawEditionBoard([], D, { generate, solve: okSolve });
  assert.equal(r.ok, false);
  assert.equal(r.failures.length, 10);
  assert.equal(calls.length, 10);
});

test('the season try-order starts at the weighted pick and walks the eligible set ascending, wrapping', () => {
  const present = [2002, 2003, 2010, 2015, 2020];
  const recent = [2003];
  const order = seasonTryOrder(present, recent, D, 5);
  const first = pickEligibleSeason(present, recent, D, 5);
  assert.equal(order[0], first, 'the weighted pick is unchanged and first');
  assert.equal(order.length, 4);
  assert.ok(!order.includes(2003), 'a season in cooldown is never tried');
  assert.deepEqual([...order].sort((a, b) => a - b), [2002, 2010, 2015, 2020]);
  const i = [2002, 2010, 2015, 2020].indexOf(first);
  assert.deepEqual(order, [...[2002, 2010, 2015, 2020].slice(i), ...[2002, 2010, 2015, 2020].slice(0, i)]);
  assert.deepEqual(seasonTryOrder(present, recent, D, 5), order, 'deterministic');
  assert.deepEqual(seasonTryOrder([2015], [2015], D, 5), []);
});

test('ensureBoardForDate stores the seed it actually used, and that seed reproduces the stored board', async () => {
  const row = await ensureBoardForDate(sql, EDITION_DATE);
  if (!created.includes(row.id)) created.push(row.id);
  assert.ok(editionSeeds(EDITION_DATE).includes(row.seed), `stored seed ${row.seed} is one of the ladder`);
  const rows = await sql`
    SELECT team_key, position, raw_name, pass_yds, pass_td, pass_int, rush_yds, rush_td,
           rec, rec_yds, rec_td, fumbles_lost, fgm, fga, xp, sacks, def_int, def_td
      FROM nfl_player_season_totals WHERE season_year = ${row.season_year}`;
  const r = drawEditionBoard(rows, EDITION_DATE);
  assert.equal(r.ok, true);
  assert.equal(r.seed, row.seed);
  assert.equal(r.optimum.total, Number(row.ceiling));
});
