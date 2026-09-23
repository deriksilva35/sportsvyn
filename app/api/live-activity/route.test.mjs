// app/api/live-activity/route.test.mjs - both routes against DEV, exactly as
// the contract states them:
//   register  { activityId, pushToken, matchId, startedAt }  200 · 401 · 400
//   end       { activityId }                                 200 · 401 · 400
//
// auth() is stubbed to a SENTINEL user created here and deleted after - never
// a real account's row. The stub reads its answer from a file on every call,
// so one loaded module can serve the signed-in and signed-out cases without
// re-importing the routes.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { install } from '../../../lib/testing/nextResolve.mjs';
install();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..', '..');
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

const STUB = stubPath('__auth_stub.mjs');
const STATE = stubPath('__auth_state.json');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === '@/auth') return { url: pathToFileURL(STUB).href, shortCircuit: true };
  return next(spec, ctx);
} });

const { sql } = await import('../../../lib/db.js');
import { stubPath } from '../../../lib/testing/stubDir.mjs';

const NS = `sentinel-la-route-${Date.now()}`;
const ACT = `${NS}-a1`;
const TOKEN = 'c'.repeat(160);
let userId; let matchId; let registerPOST; let endPOST;

const signedInAs = (id) => writeFileSync(STATE, JSON.stringify({ userId: id }));

before(async () => {
  const [u] = await sql`INSERT INTO users (email) VALUES (${`${NS}@example.invalid`}) RETURNING id`;
  userId = u.id;
  const [m] = await sql`SELECT id FROM matches ORDER BY id ASC LIMIT 1`;
  matchId = m.id;
  signedInAs(userId);
  writeFileSync(STUB, [
    "import { readFileSync } from 'node:fs';",
    `const STATE = ${JSON.stringify(STATE)};`,
    'export async function auth() {',
    '  const s = JSON.parse(readFileSync(STATE, "utf8"));',
    '  return s.userId == null ? null : { user: { id: s.userId } };',
    '}',
    '',
  ].join('\n'));
  ({ POST: registerPOST } = await import('./register/route.js'));
  ({ POST: endPOST } = await import('./end/route.js'));
});

after(async () => {
  await sql`DELETE FROM live_activities WHERE activity_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  for (const f of [STUB, STATE]) { try { unlinkSync(f); } catch { /* gone */ } }
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM live_activities WHERE activity_id LIKE 'sentinel-la-route-%') AS acts,
           (SELECT count(*)::int FROM users WHERE email LIKE 'sentinel-la-route-%') AS users`;
  assert.equal(left.acts, 0, 'sentinel activities left behind');
  assert.equal(left.users, 0, 'sentinel users left behind');
});

const post = (fn, body) => fn(new Request('https://sportsvyn.test/api/live-activity', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

test('register: the contract\'s body stores a row and answers {ok:true}', async () => {
  signedInAs(userId);
  const res = await post(registerPOST, {
    activityId: ACT, pushToken: TOKEN, matchId, startedAt: '2026-09-20T20:20:00.000Z',
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const [row] = await sql`SELECT * FROM live_activities WHERE activity_id = ${ACT}`;
  assert.equal(row.push_token, TOKEN);
  assert.equal(row.user_id, userId);
  assert.equal(row.match_id, matchId);
  assert.equal(new Date(row.started_at).toISOString(), '2026-09-20T20:20:00.000Z');
});

test('register: signed out is 401 and writes nothing', async () => {
  signedInAs(null);
  const res = await post(registerPOST, { activityId: `${NS}-nope`, pushToken: TOKEN, matchId });
  assert.equal(res.status, 401);
  const rows = await sql`SELECT activity_id FROM live_activities WHERE activity_id = ${`${NS}-nope`}`;
  assert.equal(rows.length, 0);
});

test('register: malformed is 400, and says which field', async () => {
  signedInAs(userId);
  const noId = await post(registerPOST, { pushToken: TOKEN, matchId });
  assert.equal(noId.status, 400);
  assert.deepEqual(await noId.json(), { error: 'bad activityId' });
  const badToken = await post(registerPOST, { activityId: `${NS}-b`, pushToken: 'not-hex', matchId });
  assert.equal(badToken.status, 400);
  assert.deepEqual(await badToken.json(), { error: 'bad pushToken' });
});

test('register: a match this database never heard of is a 400, not a 500', async () => {
  signedInAs(userId);
  const res = await post(registerPOST, { activityId: `${NS}-ghost`, pushToken: TOKEN, matchId: 2147483000 });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'unknown matchId' });
});

test('end: the app says it is gone, and the row is stamped', async () => {
  signedInAs(userId);
  const res = await post(endPOST, { activityId: ACT });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, ended: true });
  const [row] = await sql`SELECT ended_at FROM live_activities WHERE activity_id = ${ACT}`;
  assert.ok(row.ended_at);
});

test('end: calling it twice is ok, and honest that the second did nothing', async () => {
  signedInAs(userId);
  const res = await post(endPOST, { activityId: ACT });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, ended: false });
});

test('end: an id we never had is ok:true and not an existence oracle', async () => {
  signedInAs(userId);
  const res = await post(endPOST, { activityId: `${NS}-never-existed` });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, ended: false });
});

test('end: signed out is 401, malformed is 400', async () => {
  signedInAs(null);
  assert.equal((await post(endPOST, { activityId: ACT })).status, 401);
  signedInAs(userId);
  const bad = await post(endPOST, {});
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'bad activityId' });
});
