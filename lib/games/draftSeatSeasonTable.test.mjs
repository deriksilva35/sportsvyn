// lib/games/draftSeatSeasonTable.test.mjs - the Draft's by-seat SEASON table
// (relay 2b item 7): avg pct per seat across weeks, min 3 drafters. Minimal
// fixture - just the drafts/contests/contest_entries rows the query reads,
// no real draft_picks needed since draftSeatSeasonTable() never touches them.

import { test, after } from 'node:test';
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
const { draftSeatSeasonTable, SEAT_TABLE_MIN_DRAFTERS } = await import('./leaderboard.js');

// TIMESTAMPED, not a fixed address: users.email carries no unique
// constraint this suite can rely on for ON CONFLICT DO NOTHING, so a fixed
// sentinel address risks a stale duplicate row from an earlier interrupted
// run being silently reused instead of inserted fresh (confirmed empirically
// - two rows, same email, after one aborted run).
const EMAIL = `draftseatseasontest-${Date.now()}@example.invalid`;
const contestIds = [];
const draftIds = [];
const cfgIds = [];
let userId;

after(async () => {
  await sql`DELETE FROM contest_entries WHERE contest_id = ANY(${contestIds})`;
  await sql`DELETE FROM contests WHERE id = ANY(${contestIds})`;
  await sql`DELETE FROM drafts WHERE id = ANY(${draftIds})`;
  await sql`DELETE FROM draft_configs WHERE id = ANY(${cfgIds})`;
  await sql`DELETE FROM users WHERE email = ${EMAIL}`;
});

async function mkWeek(week, seatPcts) {
  const cid = (await sql`
    INSERT INTO contests (game_type, sport, season_year, week, board, opens_at, locks_at, settled)
    VALUES ('draft', 'draftseatseasontest', 2091, ${week}, '[]'::jsonb, now(), now(), true)
    RETURNING id`)[0].id;
  contestIds.push(cid);
  const cfg = (await sql`
    INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots, pick_timer_seconds, is_preset, source)
    VALUES (${userId}, 'seat season test', 12, 'ppr', '{}'::jsonb, 30, false, 'manual') RETURNING id`)[0].id;
  cfgIds.push(cfg);
  const snap = (await sql`SELECT max(snapshot_date) d FROM sim_player_pool WHERE source = 'ffc'`)[0].d;
  for (const [seat, pct] of Object.entries(seatPcts)) {
    const draft = (await sql`
      INSERT INTO drafts (user_id, config_id, status, pick_position, is_auto,
                          pool_snapshot_date, pool_scoring_format, pool_teams_count, started_at, mode)
      VALUES (${userId}, ${cfg}, 'completed', ${Number(seat)}, false, ${snap}, 'ppr', 12, now(), 'sim') RETURNING id`)[0].id;
    draftIds.push(draft);
    await sql`
      INSERT INTO contest_entries (contest_id, user_id, lineup, meta)
      VALUES (${cid}, ${userId}, '{}'::jsonb, ${JSON.stringify({ draftId: draft, pct })}::jsonb)`;
  }
}

await (async () => {
  userId = (await sql`INSERT INTO users (email) VALUES (${EMAIL})
    ON CONFLICT DO NOTHING RETURNING id`)[0]?.id
    ?? (await sql`SELECT id FROM users WHERE email = ${EMAIL}`)[0].id;
  // Seat 1: three weeks, avg (90+80+70)/3 = 80 - eligible.
  await mkWeek(1, { 1: 90 });
  await mkWeek(2, { 1: 80 });
  await mkWeek(3, { 1: 70 });
  // Seat 2: two weeks only - under the floor.
  await mkWeek(4, { 2: 60 });
  await mkWeek(5, { 2: 40 });
})();

test('a seat with enough drafters shows a real average, sorted first', async () => {
  const table = await draftSeatSeasonTable(12);
  assert.equal(table.length, 12, 'every seat listed');
  const seat1 = table.find((s) => s.seat === 1);
  assert.equal(seat1.drafters, 3);
  assert.equal(seat1.avgPct, 80);
  assert.equal(seat1.note, null);
  assert.equal(table[0].seat, 1, 'the only eligible seat sorts first');
});

test(`a seat under ${SEAT_TABLE_MIN_DRAFTERS} drafters shows the note, not a false average`, async () => {
  const table = await draftSeatSeasonTable(12);
  const seat2 = table.find((s) => s.seat === 2);
  assert.equal(seat2.drafters, 2);
  assert.equal(seat2.avgPct, null);
  assert.equal(seat2.note, '2 of 3');
});

test('an undrafted seat reads as zero drafters, not absent from the table', async () => {
  const table = await draftSeatSeasonTable(12);
  const seat12 = table.find((s) => s.seat === 12);
  assert.equal(seat12.drafters, 0);
  assert.equal(seat12.note, '0 of 3');
});
