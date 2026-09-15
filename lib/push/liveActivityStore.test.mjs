// lib/push/liveActivityStore.test.mjs - the contract's two routes' worth of
// storage, against DEV.
//
// A SENTINEL USER AND SENTINEL ACTIVITY IDS, never a real account's row and
// never a real Activity: everything here is created by this file and deleted
// by it, and the teardown verifies itself rather than assuming.
//
// THE SENDER IS ALWAYS A FAKE. What is under test is the fan-out, the
// revocation on a dead token and the gate - not that Apple is up.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  parseRegister, parseEnd, registerActivity, endActivity,
  liveActivitiesFor, revokeActivity, pushLiveActivities,
} from './liveActivityStore.js';

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

const NS = `sentinel-la-${Date.now()}`;
const A1 = `${NS}-a1`;
const A2 = `${NS}-a2`;
const TOKEN = 'a'.repeat(160);
const TOKEN2 = 'b'.repeat(160);
const ARMED = {
  PUSH_ENABLED: '1',
  APNS_KEY: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----',
  APNS_KEY_ID: 'ABCDE12345', APNS_TEAM_ID: '87BX25MUHY', APNS_ENV: 'production',
};
let userId; let matchId; let otherUserId;

before(async () => {
  const [u] = await sql`INSERT INTO users (email) VALUES (${`${NS}@example.invalid`}) RETURNING id`;
  userId = u.id;
  const [o] = await sql`INSERT INTO users (email) VALUES (${`${NS}-other@example.invalid`}) RETURNING id`;
  otherUserId = o.id;
  const [m] = await sql`SELECT id FROM matches ORDER BY id DESC LIMIT 1`;
  matchId = m.id;
});

after(async () => {
  await sql`DELETE FROM live_activities WHERE activity_id LIKE ${`${NS}%`}`;
  await sql`DELETE FROM users WHERE id = ANY(${[userId, otherUserId]})`;
  const [left] = await sql`
    SELECT (SELECT count(*)::int FROM live_activities WHERE activity_id LIKE 'sentinel-la-%') AS acts,
           (SELECT count(*)::int FROM users WHERE email LIKE 'sentinel-la-%') AS users`;
  assert.equal(left.acts, 0, 'sentinel activities left behind');
  assert.equal(left.users, 0, 'sentinel users left behind');
});

// ---------------------------------------------------------------------------
// THE SHAPE OF THE CONTRACT
// ---------------------------------------------------------------------------

test('parseRegister takes the contract\'s four fields', () => {
  const r = parseRegister({
    activityId: 'F3C2A1B0-1111-2222-3333-444455556666',
    pushToken: TOKEN, matchId: 21569, startedAt: '2026-09-20T20:20:00.000Z',
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.activityId, 'F3C2A1B0-1111-2222-3333-444455556666');
  assert.equal(r.value.matchId, 21569);
  assert.equal(r.value.startedAt.toISOString(), '2026-09-20T20:20:00.000Z');
});

test('parseRegister names WHICH field is malformed', () => {
  assert.deepEqual(parseRegister({}), { ok: false, reason: 'bad activityId' });
  assert.deepEqual(parseRegister({ activityId: A1 }), { ok: false, reason: 'bad pushToken' });
  assert.deepEqual(parseRegister({ activityId: A1, pushToken: TOKEN }), { ok: false, reason: 'bad matchId' });
  assert.deepEqual(
    parseRegister({ activityId: A1, pushToken: TOKEN, matchId: 5, startedAt: 'not a date' }),
    { ok: false, reason: 'bad startedAt' },
  );
  // A token that is not hex is not a token, however long it is.
  assert.equal(parseRegister({ activityId: A1, pushToken: 'z'.repeat(64), matchId: 5 }).ok, false);
});

test('a missing startedAt defaults to now rather than 400-ing', () => {
  // The contract sends it; an app that forgets still has a live Activity, and
  // refusing the registration would cost the reader their card to punish the
  // client for a field we can supply.
  const r = parseRegister({ activityId: A1, pushToken: TOKEN, matchId: 5 });
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.value.startedAt.getTime() - Date.now()) < 5000);
});

test('parseEnd wants only the activityId', () => {
  assert.deepEqual(parseEnd({ activityId: A1 }), { ok: true, value: { activityId: A1 } });
  assert.deepEqual(parseEnd({}), { ok: false, reason: 'bad activityId' });
});

// ---------------------------------------------------------------------------
// STORAGE
// ---------------------------------------------------------------------------

test('a register stores the row the contract describes', async () => {
  const started = new Date('2026-09-20T20:20:00.000Z');
  const row = await registerActivity(sql, {
    activityId: A1, pushToken: TOKEN, userId, matchId, startedAt: started,
  });
  assert.equal(row.activity_id, A1);
  assert.equal(row.push_token, TOKEN);
  assert.equal(row.user_id, userId);
  assert.equal(row.match_id, matchId);
  assert.equal(new Date(row.started_at).toISOString(), started.toISOString());
  assert.equal(row.ended_at, null);
  assert.equal(row.revoked_at, null);
});

test('A REISSUED TOKEN UPDATES THE ROW, it does not make a second one', async () => {
  // Activity.pushTokenUpdates is a stream: the same Activity is registered
  // again with a new token whenever Apple reissues. Two rows for one Activity
  // would double every push it ever gets.
  await registerActivity(sql, { activityId: A1, pushToken: TOKEN2, userId, matchId, startedAt: new Date() });
  const rows = await sql`SELECT push_token FROM live_activities WHERE activity_id = ${A1}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].push_token, TOKEN2);
});

test('end stamps ended_at, and says whether THIS call is what stopped it', async () => {
  const first = await endActivity(sql, { activityId: A1, userId });
  assert.equal(first.ended, true);
  const again = await endActivity(sql, { activityId: A1, userId });
  assert.equal(again.ended, false, 'an already-ended Activity is not ended twice');
  const [row] = await sql`SELECT ended_at FROM live_activities WHERE activity_id = ${A1}`;
  assert.ok(row.ended_at, 'ended_at stamped');
});

test('ending an Activity is not a way to end somebody else\'s', async () => {
  await registerActivity(sql, { activityId: A2, pushToken: TOKEN2, userId, matchId, startedAt: new Date() });
  const r = await endActivity(sql, { activityId: A2, userId: otherUserId });
  assert.equal(r.ended, false);
  const [row] = await sql`SELECT ended_at FROM live_activities WHERE activity_id = ${A2}`;
  assert.equal(row.ended_at, null, 'still running');
});

test('a re-register revives an ended Activity in place', async () => {
  // The app only re-registers an Activity it still holds. Its word beats our
  // record of a send that failed, or a swipe it has since undone.
  await registerActivity(sql, { activityId: A1, pushToken: TOKEN, userId, matchId, startedAt: new Date() });
  const [row] = await sql`SELECT ended_at, revoked_at FROM live_activities WHERE activity_id = ${A1}`;
  assert.equal(row.ended_at, null);
  assert.equal(row.revoked_at, null);
});

test('liveActivitiesFor reads the living only', async () => {
  const live = await liveActivitiesFor(sql, matchId);
  const mine = live.filter((r) => r.activity_id.startsWith(NS)).map((r) => r.activity_id).sort();
  assert.deepEqual(mine, [A1, A2].sort());
  await revokeActivity(sql, A2);
  const after2 = await liveActivitiesFor(sql, matchId);
  assert.deepEqual(after2.filter((r) => r.activity_id.startsWith(NS)).map((r) => r.activity_id), [A1]);
  // Revive A2 for the fan-out tests below. A1 and A2 hold DIFFERENT tokens
  // from here on, so the 410 test below can kill exactly one of them.
  await registerActivity(sql, { activityId: A2, pushToken: TOKEN2, userId, matchId, startedAt: new Date() });
});

// ---------------------------------------------------------------------------
// THE FAN-OUT
// ---------------------------------------------------------------------------

test('one update goes to every live Activity on the match, once each', async () => {
  const seen = [];
  const out = await pushLiveActivities(sql, {
    matchId, event: 'update', env: ARMED,
    state: { awayAbbr: 'IND', awayScore: 7, homeAbbr: 'KC', homeScore: 14, period: 'Q2', clock: '1:39' },
    send: async (_cfg, token, payload) => { seen.push({ token, payload }); return { ok: true, status: 200, reason: null, gone: false }; },
  });
  assert.equal(out.sent, seen.length);
  assert.ok(out.sent >= 2, 'both sentinel Activities got one');
  assert.equal(out.failed, 0);
  assert.equal(out.revoked, 0);
  const p = seen[0].payload;
  assert.equal(p.aps.event, 'update');
  assert.deepEqual(p.aps['content-state'], {
    awayAbbr: 'IND', awayScore: 7, homeAbbr: 'KC', homeScore: 14, period: 'Q2', clock: '1:39',
  });
});

test('A 410 REVOKES THE ROW, it does not retry it', async () => {
  const out = await pushLiveActivities(sql, {
    matchId, event: 'update', env: ARMED, state: { awayAbbr: 'IND', homeAbbr: 'KC' },
    send: async (_cfg, token) => (token === TOKEN2
      ? { ok: false, status: 410, reason: 'Unregistered', gone: true }
      : { ok: true, status: 200, reason: null, gone: false }),
  });
  assert.ok(out.revoked >= 1);
  const [row] = await sql`SELECT revoked_at FROM live_activities WHERE activity_id = ${A2}`;
  assert.ok(row.revoked_at, 'the dead token is stamped, not deleted');
  // And it is out of the fan-out from here on.
  const live = await liveActivitiesFor(sql, matchId);
  assert.equal(live.some((r) => r.activity_id === A2), false);
});

test('a delivery failure that is NOT gone leaves the row alone', async () => {
  const out = await pushLiveActivities(sql, {
    matchId, event: 'update', env: ARMED, state: { awayAbbr: 'IND', homeAbbr: 'KC' },
    send: async () => ({ ok: false, status: 500, reason: 'InternalServerError', gone: false }),
  });
  assert.ok(out.failed >= 1);
  assert.equal(out.revoked, 0);
  const [row] = await sql`SELECT revoked_at FROM live_activities WHERE activity_id = ${A1}`;
  assert.equal(row.revoked_at, null, 'Apple having a moment is not a dead token');
});

test('an end push ends the row it was sent to', async () => {
  const out = await pushLiveActivities(sql, {
    matchId, event: 'end', env: ARMED,
    state: { awayAbbr: 'IND', awayScore: 17, homeAbbr: 'KC', homeScore: 27, period: 'F', clock: '' },
    send: async () => ({ ok: true, status: 200, reason: null, gone: false }),
  });
  assert.ok(out.sent >= 1);
  const [row] = await sql`SELECT ended_at FROM live_activities WHERE activity_id = ${A1}`;
  assert.ok(row.ended_at, 'the server ended it at the whistle');
});

test('a dark gate SKIPS, and still counts what it would have sent', async () => {
  // The difference between "four Activities and the sender is off" and "no
  // Activities" is the whole diagnosis on a night nothing arrives.
  await registerActivity(sql, { activityId: A1, pushToken: TOKEN, userId, matchId, startedAt: new Date() });
  let called = false;
  const out = await pushLiveActivities(sql, {
    matchId, event: 'update', env: {}, state: { awayAbbr: 'IND', homeAbbr: 'KC' },
    send: async () => { called = true; return { ok: true, status: 200, reason: null, gone: false }; },
  });
  assert.equal(called, false, 'nothing sent from a dark environment');
  assert.ok(out.activities >= 1);
  assert.equal(out.skipped, out.activities);
  assert.equal(out.sent, 0);
});

test('a match with no Activities is zero work and no error', async () => {
  const out = await pushLiveActivities(sql, {
    matchId: -1, event: 'update', env: ARMED, state: {},
    send: async () => { throw new Error('must not send'); },
  });
  assert.deepEqual(out, { matchId: -1, event: 'update', activities: 0, sent: 0, failed: 0, revoked: 0, skipped: 0 });
});
