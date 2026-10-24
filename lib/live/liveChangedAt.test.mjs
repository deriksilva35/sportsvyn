// lib/live/liveChangedAt.test.mjs - G6's clock: writeLive stamps metadata.live_changed_at
// (top level) only when status, a score, or the live_state period/clock really changes.
// Sentinel match on DEV, torn down in after().
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { writeLive } from './write.js';

(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(new URL('../../.env.local', import.meta.url).pathname);

const sql = neon(process.env.DATABASE_URL);
const SLUG = `g6-live-changed-${process.pid}-${Date.now()}`;
let id;
const stamp = async () => (await sql`SELECT metadata->>'live_changed_at' AS t FROM matches WHERE id = ${id}`)[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  const [lg] = await sql`SELECT id FROM leagues ORDER BY id LIMIT 1`;
  const r = await sql`INSERT INTO matches (league_id, season_year, season_phase, week, kickoff_at, status, slug, metadata)
                      VALUES (${lg.id}, 1999, 'REG', 99, now(), 'live', ${SLUG}, '{"keep":1}'::jsonb) RETURNING id`;
  id = r[0].id;
});
after(async () => {
  if (id) await sql`DELETE FROM matches WHERE id = ${id}`;
  const left = await sql`SELECT count(*)::int c FROM matches WHERE slug = ${SLUG}`;
  assert.equal(left[0].c, 0, 'teardown left the sentinel match');
});

test('live_changed_at is stamped on change, held on a repeat, and win_prob alone does not move it', async () => {
  await writeLive(sql, id, { status: 'live', homeScore: 0, awayScore: 0, liveState: { period: 1, clock: '15:00' } });
  const a = await stamp();
  assert.ok(a.t, 'first live write stamps');
  await sleep(1100);
  // same score, same period/clock; only win_prob (changes every poll) differs
  await writeLive(sql, id, { status: 'live', homeScore: 0, awayScore: 0, liveState: { period: 1, clock: '15:00', win_prob: 0.55, win_prob_at: 'x' } });
  assert.equal((await stamp()).t, a.t, 'unchanged score and clock: not restamped');
  await sleep(1100);
  await writeLive(sql, id, { status: 'live', homeScore: 0, awayScore: 0, liveState: { period: 1, clock: '14:30' } });
  const b = await stamp();
  assert.notEqual(b.t, a.t, 'clock moved: restamped');
  await sleep(1100);
  await writeLive(sql, id, { status: 'live', homeScore: 7, awayScore: 0, liveState: { period: 1, clock: '14:30' } });
  assert.notEqual((await stamp()).t, b.t, 'score moved: restamped');
  const row = (await sql`SELECT metadata FROM matches WHERE id = ${id}`)[0].metadata;
  assert.equal(row.keep, 1, 'sibling top-level keys survive');
  assert.ok(!('live_changed_at' in (row.detail ?? {})), 'top-level key, never nested under detail');
});
