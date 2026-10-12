// lib/mockNba/setups.db.test.mjs - named NBA mock setups on DEV (mon-2): save, load,
// overwrite, rename, delete, the 10-per-account limit, names unique per account,
// another reader's setup unreachable, and custom values round-tripping EXACTLY.
// Test-owned users dgnbatest-setups-*, removed in after() (setups cascade with them).
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
const { listSetups, createSetup, updateSetup, deleteSetup, MAX_SETUPS } = await import('./setups.js');
const { normalizeSettings, DEFAULT_SETTINGS } = await import('./settings.js');
const { POINTS_LEAGUE } = await import('./scoring.js');

const users = [];
async function user() {
  const [u] = await sql`INSERT INTO users (email, name) VALUES (${`dgnbatest-setups-${Date.now()}-${users.length}@example.invalid`}, 'setups test') RETURNING id`;
  users.push(u.id); return u.id;
}
after(async () => {
  if (users.length) await sql`DELETE FROM users WHERE id = ANY(${users})`;
  const [left] = await sql`SELECT count(*)::int AS n FROM nba_mock_setups WHERE user_id = ANY(${users})`;
  assert.equal(left.n, 0, 'teardown left no setups');
});

// Every field off its default, custom values with decimals and negatives.
const CUSTOM = normalizeSettings({
  ...DEFAULT_SETTINGS, teams: 10, seat: 7, clock: 30,
  scoring: 'custom', customWeights: { ...POINTS_LEAGUE, pts: 1.5, fga: -0.5, ast: 2.5, stl: 3.5, blk: -1, tov: -2.5 },
  roster: 'custom', customCounts: { PG: 2, SG: 0, SF: 1, PF: 1, C: 3, G: 0, F: 2, UTIL: 4, BN: 1 },
});

test('save + load: custom values round-trip EXACTLY', async () => {
  const u = await user();
  const r = await createSetup(u, '  Home   league ', CUSTOM);
  assert.equal(r.ok, true); assert.equal(r.setup.name, 'Home league', 'name trimmed, spaces collapsed');
  const [back] = await listSetups(u);
  assert.deepEqual(back.settings, CUSTOM);
  const [raw] = await sql`SELECT settings FROM nba_mock_setups WHERE id = ${r.setup.id}`;
  assert.deepEqual(raw.settings, CUSTOM, 'stored as given, not re-derived');
});

test('edit: overwrite settings, rename, both scoped to the owner; names unique per account', async () => {
  const u = await user(); const other = await user();
  const a = (await createSetup(u, 'Work', normalizeSettings(DEFAULT_SETTINGS))).setup;
  await createSetup(u, 'Family', CUSTOM);
  const over = await updateSetup(u, a.id, { settings: CUSTOM });
  assert.equal(over.ok, true); assert.deepEqual(over.setup.settings, CUSTOM); assert.equal(over.setup.name, 'Work');
  const ren = await updateSetup(u, a.id, { name: 'Office' });
  assert.equal(ren.setup.name, 'Office'); assert.deepEqual(ren.setup.settings, CUSTOM, 'rename keeps the settings');
  assert.deepEqual(await updateSetup(u, a.id, { name: 'family' }), { ok: false, reason: 'name_taken' }, 'case-insensitive');
  assert.deepEqual(await createSetup(u, 'OFFICE', CUSTOM), { ok: false, reason: 'name_taken' });
  assert.equal((await createSetup(other, 'Office', CUSTOM)).ok, true, 'another reader may use the same name');
  assert.deepEqual(await updateSetup(other, a.id, { name: 'Mine now' }), { ok: false, reason: 'not_found' }, 'another reader cannot touch it');
  assert.deepEqual(await deleteSetup(other, a.id), { ok: false, reason: 'not_found' });
  assert.deepEqual(await updateSetup(u, a.id, { name: '   ' }), { ok: false, reason: 'bad_name' });
  assert.deepEqual(await createSetup(u, 'x'.repeat(41), CUSTOM), { ok: false, reason: 'bad_name' });
  assert.deepEqual((await listSetups(u)).map((s) => s.name), ['Office', 'Family'], 'most recently saved first');
});

test('delete, and the limit of 10 per account', async () => {
  const u = await user();
  const made = [];
  for (let i = 1; i <= MAX_SETUPS; i += 1) made.push((await createSetup(u, `League ${i}`, CUSTOM)).setup);
  assert.equal(MAX_SETUPS, 10);
  assert.deepEqual(await createSetup(u, 'Eleven', CUSTOM), { ok: false, reason: 'limit' });
  assert.equal((await listSetups(u)).length, 10);
  assert.deepEqual(await deleteSetup(u, made[0].id), { ok: true });
  assert.deepEqual(await deleteSetup(u, made[0].id), { ok: false, reason: 'not_found' });
  assert.equal((await createSetup(u, 'Eleven', CUSTOM)).ok, true, 'a freed slot can be used');
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM nba_mock_setups WHERE user_id = ${u}`;
  assert.equal(n, 10);
});
