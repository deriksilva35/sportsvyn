// lib/mockNba/mockNba.db.test.mjs - the stored NBA mock pool on DEV (sun-5): its
// size, and full drafts against the REAL pool (no stall, every slot legal).
// Read-only: the pool row is written by /api/cron/nba-mock-pool (or by hand on DEV).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
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

const { readNbaMockPool, POOL_MIN } = await import('./pool.js');
const { createMock, runBots, applyPick, legalFor, isDone, TOTAL } = await import('./draft.js');

test('pool size: DEV holds a stored pool of at least POOL_MIN, ranked, with centers enough for 12 teams', async () => {
  const pool = await readNbaMockPool();
  assert.ok(pool, 'DEV has an nba_mock_pool row for the season (build it with the cron or lib/mockNba/pool.js)');
  assert.ok(pool.rows.length >= POOL_MIN, `pool ${pool.rows.length} < ${POOL_MIN}`);
  assert.ok(pool.rows.every((r, i) => r.rank === i + 1 && r.sv != null && r.name));
  const centers = pool.rows.filter((r) => String(r.pos).split('-').includes('C')).length;
  assert.ok(centers >= 24, `only ${centers} center-eligible players`);
});

test('full drafts on the real pool: no stall, every roster 13 deep', async () => {
  const pool = (await readNbaMockPool()).rows;
  for (const seed of [1, 2, 3, 4, 5]) {
    let st = runBots(createMock(pool, { userSeat: seed % 12, seed }));
    while (!isDone(st)) st = runBots(applyPick(st, legalFor(st, st.userSeat)[seed % 3]?.id ?? legalFor(st, st.userSeat)[0].id, 'user'));
    assert.equal(st.picks.length, TOTAL);
    assert.ok(st.rosters.every((r) => r.every((x) => x.player)));
  }
});
