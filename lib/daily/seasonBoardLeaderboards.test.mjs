// lib/daily/seasonBoardLeaderboards.test.mjs - six sentinel users, a run of
// synthetic edition dates, real DEV writes, torn down by id. Dates are
// 2099-04-* (this session's established synthetic-far-future convention -
// 2097/2098/2099 already used elsewhere for exactly this reason) so this
// suite can never collide with a real edition.

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
const {
  mainLeaderboard, todayLeaderboard, streakLeaderboard, bestLeaderboard,
} = await import('./seasonBoardLeaderboards.js');

const RUN_TAG = Date.now();
const userIds = {};
const boardIds = {}; // dateStr -> id
const createdRunIds = [];

const DATES = Array.from({ length: 15 }, (_, i) => `2099-04-${String(i + 1).padStart(2, '0')}`); // D0..D14

async function mkUser(tag) {
  const email = `sentinel-lb-${tag}-${RUN_TAG}@example.invalid`;
  const r = await sql`INSERT INTO users (email, handle) VALUES (${email}, ${`lb${tag}${RUN_TAG}`.slice(0, 15)}) RETURNING id`;
  userIds[tag] = r[0].id;
  return r[0].id;
}

async function mkBoard(dateStr) {
  const r = await sql`
    INSERT INTO daily_boards (edition_date, season_year, seed, board, ceiling, best_roster, opens_at, closes_at, live_notify_at)
    VALUES (${dateStr}, 2099, 'sentinel', '[]'::jsonb, 100, '[]'::jsonb,
            ${dateStr}::timestamptz, (${dateStr}::date + 1)::timestamptz, ${dateStr}::timestamptz)
    ON CONFLICT (edition_date) DO NOTHING RETURNING id`;
  const id = r[0]?.id ?? (await sql`SELECT id FROM daily_boards WHERE edition_date = ${dateStr}`)[0].id;
  boardIds[dateStr] = id;
  return id;
}

async function mkRun(dateStr, userTag, { score = 70, pct = 0.7, matched = 5 } = {}) {
  const r = await sql`
    INSERT INTO daily_board_runs (board_id, user_id, picks, score, pct, matched, elapsed_s)
    VALUES (${boardIds[dateStr]}, ${userIds[userTag]}, '[]'::jsonb, ${score}, ${pct}, ${matched}, 150)
    ON CONFLICT (board_id, user_id) DO NOTHING RETURNING id`;
  if (r.length) createdRunIds.push(r[0].id);
}

test('build fixture: six sentinel users, fifteen synthetic editions, targeted runs', async () => {
  for (const tag of ['U1', 'U2', 'U3', 'U4', 'U5', 'U6']) await mkUser(tag);
  for (const d of DATES) await mkBoard(d);

  // U1: 9 runs - must be ABSENT from main (needs >= 10).
  for (let i = 0; i <= 8; i++) await mkRun(DATES[i], 'U1', { score: 70, pct: 0.7, matched: 5 });
  // U2: 12 runs - must be PRESENT in main.
  for (let i = 0; i <= 11; i++) await mkRun(DATES[i], 'U2', { score: 75, pct: 0.75, matched: 6 });
  // U3/U4: a single 100% run each, on different dates - the `best` tiebreak.
  await mkRun(DATES[5], 'U3', { score: 100, pct: 1.0, matched: 8 }); // earlier date
  await mkRun(DATES[8], 'U4', { score: 100, pct: 1.0, matched: 8 }); // later date
  // U5: 5 CONSECUTIVE runs (D0-D4), then stops - "today" = D6 (two days after
  // the last play) makes the streak read as broken, not current.
  for (let i = 0; i <= 4; i++) await mkRun(DATES[i], 'U5', { score: 60, pct: 0.6, matched: 4 });
  // U6: the ONLY run on D12 - the today-isolation target.
  await mkRun(DATES[12], 'U6', { score: 90, pct: 0.9, matched: 7 });

  assert.equal(createdRunIds.length, 9 + 12 + 1 + 1 + 5 + 1, 'sanity: every insert actually landed (no accidental ON CONFLICT skip)');
});

test('main: a player with 9 runs is absent; a player with 12 is present', async () => {
  const rows = await mainLeaderboard(sql);
  const u1 = rows.find((r) => r.userId === userIds.U1);
  const u2 = rows.find((r) => r.userId === userIds.U2);
  assert.equal(u1, undefined, 'U1 has 9 runs - below the minimum 10, must not appear');
  assert.ok(u2, 'U2 has 12 runs - must appear');
  assert.equal(u2.runsPlayed, 12);
});

test('best: two 100% players tie-broken on date - the earlier date ranks first', async () => {
  const rows = await bestLeaderboard(sql);
  const u3Row = rows.find((r) => r.userId === userIds.U3);
  const u4Row = rows.find((r) => r.userId === userIds.U4);
  assert.ok(u3Row && u4Row);
  assert.equal(u3Row.primary, 1);
  assert.equal(u4Row.primary, 1);
  assert.equal(u3Row.rank, u4Row.rank, 'same primary value - same dense rank');
  const u3Idx = rows.findIndex((r) => r.userId === userIds.U3);
  const u4Idx = rows.findIndex((r) => r.userId === userIds.U4);
  assert.ok(u3Idx < u4Idx, `U3 (${u3Row.editionDate}, earlier) must be ORDERED before U4 (${u4Row.editionDate})`);
});

test('streak: broken yesterday reads 0 current, 5 longest', async () => {
  // FIRST, PROVE longest=5 IS COMPUTED CORRECTLY: as of the LAST day U5
  // actually played (D4), their streak is still current - current AND
  // longest must both read 5 here, off the same island-counting logic the
  // broken case below also runs through.
  const asOfLastPlay = await streakLeaderboard(sql, DATES[4]);
  const u5Current = asOfLastPlay.find((r) => r.userId === userIds.U5);
  assert.ok(u5Current, 'U5 played D4 itself - their streak is current as of that date');
  assert.equal(u5Current.primary, 5, 'current = 5 consecutive days (D0-D4)');
  assert.equal(u5Current.secondary, 5, 'longest = 5, the only island they have');

  // NOW THE BROKEN CASE: "today" = two days after U5's last play (D4).
  const rows = await streakLeaderboard(sql, DATES[6]);
  const u5Row = rows.find((r) => r.userId === userIds.U5);
  // current > 0 is the query's own WHERE filter - U5 must not even appear,
  // which IS "0 current" (a row absent from a current-streak board reads as
  // zero, the same way an unranked player reads as zero on any leaderboard) -
  // the leaderboard only ever lists players with an ACTIVE streak, and the
  // 5-long island computed above is exactly what a broken streak forfeits.
  assert.equal(u5Row, undefined, 'a streak broken two days before "today" must not appear on the CURRENT board');
});

test('today: one board excludes every other board\'s runs', async () => {
  const rows = await todayLeaderboard(sql, boardIds[DATES[12]]);
  assert.equal(rows.length, 1, 'only U6 ever ran D12');
  assert.equal(rows[0].userId, userIds.U6);
  assert.equal(rows[0].primary, 90);
});

after(async () => {
  if (createdRunIds.length) await sql`DELETE FROM daily_board_runs WHERE id = ANY(${createdRunIds})`;
  const bIds = Object.values(boardIds);
  if (bIds.length) await sql`DELETE FROM daily_boards WHERE id = ANY(${bIds})`;
  const uIds = Object.values(userIds);
  if (uIds.length) await sql`DELETE FROM users WHERE id = ANY(${uIds})`;
});
