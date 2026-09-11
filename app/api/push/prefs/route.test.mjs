// app/api/push/prefs/route.test.mjs — the route against DEV (ALERTS SHEET
// relay, item 4): a fresh user's master ON writes the DEFAULTS row, master OFF
// keeps the triggers, GET reads `final` back out of the final_only column.
// auth() is stubbed to a SENTINEL user created here and deleted after - never
// a real account's row.
//
// ALERTS_PASTE=1 prints the alert_prefs row after the one master tap.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../../../lib/testing/nextResolve.mjs';
import { DEFAULTS, OFF } from '../../../../lib/push/prefs.js';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..', '..');
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

const STUB = path.join(__dirname, '__auth_stub.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '@/auth') return { url: pathToFileURL(STUB).href, shortCircuit: true };
  return next(spec, ctx);
} });

const { sql } = await import('../../../../lib/db.js');
const NS = `prefsroute-${Date.now()}`;
const SCOPE_ID = 900000000 + (Date.now() % 1000000); // a match id nothing on DEV has
let userId; let GET; let PUT; let DELETE;

before(async () => {
  const [u] = await sql`INSERT INTO users (email) VALUES (${`${NS}@example.invalid`}) RETURNING id`;
  userId = u.id;
  writeFileSync(STUB, `export async function auth() { return { user: { id: ${userId} } }; }\n`);
  ({ GET, PUT, DELETE } = await import('./route.js'));
});
after(async () => {
  await sql`DELETE FROM alert_prefs WHERE user_id = ${userId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  try { unlinkSync(STUB); } catch { /* gone */ }
});

const get = async () => (await GET(new Request(`https://sportsvyn.test/api/push/prefs?matchId=${SCOPE_ID}`))).json();
const put = async (body) => (await PUT(new Request('https://sportsvyn.test/api/push/prefs', {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'match', scopeId: SCOPE_ID, ...body }) }))).json();
const row = async () => (await sql`SELECT user_id, scope, scope_id, master, kickoff, score, quarter, close, final_only
  FROM alert_prefs WHERE user_id = ${userId} AND scope = 'match' AND scope_id = ${SCOPE_ID}`)[0] ?? null;

test('a fresh user reads OFF, and one master tap writes the DEFAULTS row (R1)', async () => {
  assert.equal(await row(), null, 'no row before the tap');
  assert.deepEqual(await get(), { signedIn: true, prefs: { ...OFF, source: 'default' } });
  // The sheet sends the flags it was showing with master flipped: OFF + master.
  const r = await put({ ...OFF, master: true });
  assert.deepEqual(r, { ok: true, prefs: { ...DEFAULTS, source: 'match' } });
  const saved = await row();
  assert.deepEqual(saved, { user_id: userId, scope: 'match', scope_id: SCOPE_ID,
    master: true, kickoff: true, score: true, quarter: false, close: true, final_only: true });
  if (process.env.ALERTS_PASTE) console.log(`\nPASTE alert_prefs row on DEV after one master tap (sentinel user ${userId}):\n${JSON.stringify(saved)}\n`);
  // And the read maps final_only back to `final`.
  assert.deepEqual(await get(), { signedIn: true, prefs: { ...DEFAULTS, source: 'match' } });
});

test('master OFF keeps the triggers; master ON again with a row keeps the reader\'s flags', async () => {
  await put({ ...OFF });
  assert.deepEqual(await row(), { user_id: userId, scope: 'match', scope_id: SCOPE_ID,
    master: false, kickoff: true, score: true, quarter: false, close: true, final_only: true }, 'master false, triggers untouched');
  await put({ master: true, kickoff: false, score: false, quarter: false, close: false, final: true });
  assert.deepEqual((await get()).prefs, { master: true, kickoff: false, score: false, quarter: false, close: false, final: true, source: 'match' });
  await put({ master: true, kickoff: false, score: false, quarter: false, close: false, final: false });
  assert.equal((await row()).final_only, false, 'the final can be turned off like any trigger');
});

test('DELETE is reset: the next read is OFF again and the next master tap is DEFAULTS again', async () => {
  await DELETE(new Request('https://sportsvyn.test/api/push/prefs', { method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: 'match', scopeId: SCOPE_ID }) }));
  assert.equal(await row(), null);
  assert.deepEqual((await get()).prefs, { ...OFF, source: 'default' });
  await put({ ...OFF, master: true });
  assert.equal((await row()).final_only, true);
});
