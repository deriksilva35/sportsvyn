// lib/mockNba/mockNba.db.test.mjs - the stored NBA mock pool and ADP on DEV (sun-5, sun-7):
// size, full drafts against the REAL pool (no stall, every slot legal) under both
// bot keys, and the recording/settings round trips (test-owned rows, removed).
import { test, after } from 'node:test';
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

const { sql } = await import('../db.js');
const { readNbaMockPool, POOL_MIN } = await import('./pool.js');
const { readAdp, withAdp } = await import('./adp.js');
const { rankPool } = await import('./rank.js');
const { createMock, runBots, applyPick, legalFor, isDone, totalPicks, autoDraftRest } = await import('./draft.js');
const { gradeMock } = await import('./grade.js');
const { eligible, slotsFromCounts, ROSTER_PRESETS } = await import('./roster.js');
const { cleanMockRecord, recordMock, saveMockSettings, readMockSettings, clearMockSettings } = await import('./record.js');
const { normalizeSettings, DEFAULT_SETTINGS } = await import('./settings.js');

const made = { drafts: [], users: [] };
after(async () => {
  if (made.drafts.length) await sql`DELETE FROM nba_mock_drafts WHERE id = ANY(${made.drafts})`;
  if (made.users.length) await sql`DELETE FROM users WHERE id = ANY(${made.users})`;
  const [left] = await sql`SELECT count(*)::int AS n FROM users WHERE email LIKE 'dgnbatest-%'`;
  assert.equal(left.n, 0, 'teardown left no test users');
});

test('pool size: DEV holds a stored pool of at least POOL_MIN, ranked, lines kept, centers enough for 12 teams', async () => {
  const pool = await readNbaMockPool();
  assert.ok(pool, 'DEV has an nba_mock_pool row for the season (build it with the cron or lib/mockNba/pool.js)');
  assert.ok(pool.rows.length >= POOL_MIN, `pool ${pool.rows.length} < ${POOL_MIN}`);
  assert.ok(pool.rows.every((r, i) => r.svp === i + 1 && r.sv != null && r.name));
  assert.ok(pool.rows.filter((r) => !r.rookie).every((r) => r.s && r.s.gp > 0), 'every veteran carries a per-game line');
  const centers = pool.rows.filter((r) => eligible(r).has('C')).length;
  assert.ok(centers >= 24, `only ${centers} center-eligible players`);
});

test('full drafts on the real pool + ADP: no stall, every roster legal, both bot keys, two roster presets', async () => {
  const adp = await readAdp();
  const rows = rankPool(withAdp((await readNbaMockPool()).rows, adp, { on: true }));
  for (const [seed, botKey, preset, teams] of [[1, 'adp', 'standard', 12], [2, 'svp', 'twoc', 14], [3, 'adp', 'twoc', 8], [4, 'svp', 'standard', 10]]) {
    const slots = slotsFromCounts(ROSTER_PRESETS[preset].counts);
    let st = runBots(createMock(rows, { userSeat: seed % teams, seed, teams, slots, botKey }));
    while (!isDone(st)) st = runBots(applyPick(st, legalFor(st, st.userSeat)[seed % 3]?.id ?? legalFor(st, st.userSeat)[0].id, 'user'));
    assert.equal(st.picks.length, totalPicks(st));
    for (const r of st.rosters) for (const x of r) assert.ok(x.player && (x.slot === 'BN' || eligible(x.player).has(x.slot)));
  }
});

test('AUTO-DRAFT ON THE REAL POOL: 20 auto-drafts spread across grades (mon-1)', async () => {
  const rows = rankPool(withAdp((await readNbaMockPool()).rows, await readAdp(), { on: true }));
  const by = {};
  for (let k = 0; k < 20; k += 1) {
    const g = gradeMock(autoDraftRest(createMock(rows, { userSeat: k % 12, seed: 7000 + k, botKey: 'adp' }))).grade;
    by[g] = (by[g] ?? 0) + 1;
  }
  console.log('auto-draft grades on the real pool:', JSON.stringify(by));
  assert.ok(Object.keys(by).length >= 4, JSON.stringify(by));
  assert.ok((by['A+'] ?? 0) <= 8, JSON.stringify(by));
});

test('recording + saved settings round-trip through the database', async () => {
  const row = cleanMockRecord({ teams: 8, rounds: 1, scoring: 'custom', roster: 'twoc', userSeat: 2, grade: 'A', picks: [11, 12, 13, 14, 15, 16, 17, 18] });
  const id = await recordMock(row); made.drafts.push(id);
  const [back] = await sql`SELECT teams, rounds, scoring, roster, user_seat, grade, picks FROM nba_mock_drafts WHERE id = ${id}`;
  assert.deepEqual({ ...back, picks: back.picks.map(Number) }, { teams: 8, rounds: 1, scoring: 'custom', roster: 'twoc', user_seat: 2, grade: 'A', picks: [11, 12, 13, 14, 15, 16, 17, 18] });

  const [u] = await sql`INSERT INTO users (email, name) VALUES (${`dgnbatest-${Date.now()}@example.invalid`}, 'nba mock test') RETURNING id`;
  made.users.push(u.id);
  assert.equal(await readMockSettings(u.id), null);
  const s = normalizeSettings({ ...DEFAULT_SETTINGS, teams: 9, clock: 60, roster: 'custom', customCounts: { ...ROSTER_PRESETS.standard.counts, BN: 0 } });
  await saveMockSettings(u.id, s);
  assert.deepEqual(await readMockSettings(u.id), s);
  await saveMockSettings(u.id, { ...s, teams: 14 });
  assert.equal((await readMockSettings(u.id)).teams, 14, 'a second save replaces the first');
  await clearMockSettings(u.id);
  assert.equal(await readMockSettings(u.id), null, 'Reset to default clears the saved row');
});
