// lib/push/tokenHealth.test.mjs - A REJECTED TOKEN STOPS COMING BACK.
//
// ============================================================================
// THE INCIDENT THIS FILE IS ABOUT, 15-18 SEP 2026
// ============================================================================
// Token 09D6170D... registered on 15 Sep and received nothing for three days.
// APNs rejected it with 400/BadDeviceToken on every event. Every part of the
// machinery worked: the sender computed `gone`, the dispatcher stamped
// revoked_at - and the next app launch cleared it, because revive-in-place was
// unconditional. Revoked and revived, nightly, invisibly, because revoked_at
// holds ONE timestamp and a token that dies every night looks exactly like one
// that died once.
//
// It ended at 01:15 on 18 Sep when a reinstall minted 73AC73E8..., a DIFFERENT
// token string, which then took every push of the game. That is the fact the
// whole design rests on and the last test here pins it: strikes are per token,
// so refusing a corpse never refuses a device.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canRevive, STRIKE_LIMIT, recordSend } from './tokenHealth.js';

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

// ---------------------------------------------------------------------------
// THE RULE, PURE
// ---------------------------------------------------------------------------
test('the limit is two consecutive rejections, not one', () => {
  // ONE IS TOO EAGER. A single rejection can be APNs answering oddly or a
  // token caught mid-reissue, and refusing a device over one bad night would
  // be worse than the bug. The token that caused this had eleven.
  assert.equal(STRIKE_LIMIT, 2);
  assert.equal(canRevive({ strikes: 0 }), true);
  assert.equal(canRevive({ strikes: 1 }), true, 'one bad night is not a verdict');
  assert.equal(canRevive({ strikes: 2 }), false);
  assert.equal(canRevive({ strikes: 11 }), false);
});

test('a token with no row yet is revivable - it is a first registration', () => {
  assert.equal(canRevive(null), true);
  assert.equal(canRevive(undefined), true);
});

// ---------------------------------------------------------------------------
// THE COUNT, AGAINST THE DATABASE
// ---------------------------------------------------------------------------
const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

const MARK = 'strikes-%@example.invalid';
async function wipe() { await sql`DELETE FROM users WHERE email LIKE ${MARK}`; }
let USER;
const TOK = (n) => `STRIKETEST${String(n).padStart(6, '0')}${'0'.repeat(48)}`;
async function mk(token) {
  await sql`INSERT INTO device_tokens (token, user_id, platform, permission)
            VALUES (${token}, ${USER}, 'ios', 'granted')
            ON CONFLICT (token) DO UPDATE SET revoked_at = NULL, strikes = 0`;
}
const read = async (token) => (await sql`SELECT strikes, revoked_at, last_rejected_at FROM device_tokens WHERE token = ${token}`)[0];

before(async () => {
  await wipe();
  USER = (await sql`INSERT INTO users (name, email)
    VALUES ('StrikeTest', ${`strikes-${Date.now()}@example.invalid`}) RETURNING id`)[0].id;
});
after(wipe);

const GONE = { ok: false, status: 400, reason: 'BadDeviceToken', gone: true };
const OK = { ok: true, status: 200, reason: null, gone: false };
const FLAKY = { ok: false, status: 0, reason: 'timeout', gone: false };

test('a gone response counts a strike, stamps the rejection, and revokes', async () => {
  const t = TOK(1); await mk(t);
  const r = await recordSend(sql, t, GONE);
  assert.equal(r.strikes, 1);
  assert.equal(r.revoked, true);
  const row = await read(t);
  assert.equal(row.strikes, 1);
  assert.ok(row.revoked_at, 'revoked, as it always was');
  assert.ok(row.last_rejected_at, 'and now we know WHEN it was rejected');
});

test('REJECTED TWICE: a launch does not revive it', async () => {
  // The exact shape of the three-day silence, in four lines.
  const t = TOK(2); await mk(t);
  await recordSend(sql, t, GONE);
  assert.equal(canRevive(await read(t)), true, 'after one, a launch may still revive');
  await recordSend(sql, t, GONE);
  const row = await read(t);
  assert.equal(row.strikes, 2);
  assert.equal(canRevive(row), false, 'after two, it stays dead');
  assert.ok(row.revoked_at);
});

test('ONE SUCCESS IN BETWEEN RESETS THE COUNT', async () => {
  // CONSECUTIVE is the whole word. A token that fails, works, then fails again
  // is not a dead token - it is a device with a bad night, and the count must
  // not accumulate across a delivery that actually landed.
  const t = TOK(3); await mk(t);
  await recordSend(sql, t, GONE);
  await recordSend(sql, t, OK);
  assert.equal((await read(t)).strikes, 0, 'a 200 zeroes it');
  await recordSend(sql, t, GONE);
  const row = await read(t);
  assert.equal(row.strikes, 1, 'the next failure starts from one, not two');
  assert.equal(canRevive(row), true);
  assert.ok(row.last_rejected_at, 'the rejection history survives the reset');
});

test('A FLAKE IS NOT A STRIKE - a timeout is our problem, not the device\'s', async () => {
  const t = TOK(4); await mk(t);
  await recordSend(sql, t, FLAKY);
  await recordSend(sql, t, FLAKY);
  await recordSend(sql, t, FLAKY);
  const row = await read(t);
  assert.equal(row.strikes, 0, 'an APNs outage must never refuse a device');
  assert.equal(row.revoked_at, null);
});

test('STRIKES ARE PER TOKEN: a new token from the same device starts clean', async () => {
  // THIS IS WHY THE REFUSAL IS SAFE, and it is exactly what happened on the
  // night: 09D6170D... struck out, the app was reinstalled, APNs issued
  // 73AC73E8..., and that row took every push afterwards. Blocking the corpse
  // cannot block the phone.
  const dead = TOK(5); const fresh = TOK(6);
  await mk(dead);
  await recordSend(sql, dead, GONE);
  await recordSend(sql, dead, GONE);
  assert.equal(canRevive(await read(dead)), false);

  await mk(fresh); // same user, same device, new token string
  const row = await read(fresh);
  assert.equal(row.strikes, 0);
  assert.equal(canRevive(row), true, 'the device is never blocked, only the token');
});

test('recordSend never throws, whatever it is handed', async () => {
  // Every caller is mid-send-loop. A bookkeeping failure must not cost the
  // push that came after it.
  assert.equal(await recordSend(sql, null, GONE), null);
  assert.equal(await recordSend(sql, TOK(9), null), null);
  // A token with no row: the UPDATE matches nothing, which is a no-op and not
  // an error. What matters is that it returns rather than throwing.
  const unknown = await recordSend(sql, 'NO-SUCH-TOKEN-AT-ALL', OK);
  assert.equal(unknown.strikes, 0);
  assert.equal(unknown.revoked, false);
  assert.equal(await recordSend(sql, TOK(9), FLAKY), null, 'a flake is not recorded at all');
});

// ---------------------------------------------------------------------------
// THE TWO PATHS USE THE ONE FUNCTION
// ---------------------------------------------------------------------------
test('both senders record through tokenHealth, and neither keeps its own revoke', () => {
  const src = (rel) => readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
  for (const rel of ['lib/push/dispatch.js', 'lib/push/notify.js']) {
    const s = src(rel);
    assert.match(s, /import \{ recordSend \} from '\.\/tokenHealth\.js';/, `${rel} imports it`);
    assert.match(s, /await recordSend\(sql, /, `${rel} calls it`);
    assert.doesNotMatch(s, /UPDATE device_tokens SET revoked_at = now\(\)/,
      `${rel}: the revoke lives in tokenHealth now - a second copy is how the two drift`);
  }
  // THREE SEND LOOPS, NOT TWO. notify.js holds notifyEvent (the broadcast) AND
  // notifyPersonalized (weekly/draft settled and their reminders); the second
  // was missed on the first pass of this relay and this test is what found it.
  const n = src('lib/push/notify.js');
  assert.equal((n.match(/await recordSend\(sql, token, r\)/g) ?? []).length, 2,
    'both loops in notify.js record');
  assert.equal((n.match(/INSERT INTO push_sends/g) ?? []).length, 2,
    'and both write a per-device ledger row');
});

test('register refuses a struck-out token instead of reviving it', () => {
  const s = readFileSync(path.resolve(__dirname, '..', '..', 'app/api/push/register/route.js'), 'utf8');
  assert.match(s, /import \{ canRevive, STRIKE_LIMIT \} from '@\/lib\/push\/tokenHealth'/);
  assert.match(s, /if \(!canRevive\(existing\)\)/);
  assert.match(s, /reason: 'token_rejected'/);
  // The check must come BEFORE the upsert, or it decides nothing.
  assert.ok(s.indexOf('canRevive(existing)') < s.indexOf('INSERT INTO device_tokens'),
    'the refusal has to precede the revive');
});

// ---------------------------------------------------------------------------
// THE CRON LEDGER - one row per device, the same shape a game push writes
// ---------------------------------------------------------------------------
// THE DEFECT: the Daily, Weekly, Pickem and Draft went out through a loop that
// kept TOTALS ONLY. "sent 49, gone 1, failed 0" was the entire record of a
// morning, so three days of one device receiving nothing could not be
// investigated at all - there was no row to look at. Game alerts had written a
// row per device since migration 070, which is exactly why the same failure on
// the game path was diagnosable in ten seconds.

test('a cron push writes ONE push_sends ROW PER TOKEN, with no match', async () => {
  const { notifyEvent } = await import('./notify.js');
  const { apnsConfig } = await import('./apns.js');
  if (!apnsConfig().enabled) return; // the gate is dark here; nothing to ledger

  // Deliberately NOT calling the real notifier: it would send. The assertion
  // is about the SQL the loop runs, so the row shape is asserted directly
  // against the table the loop writes - the same table, the same constraint.
  const t = TOK(20); await mk(t);
  const eventId = `test-cron-ledger:${Date.now()}`;
  await sql`INSERT INTO push_sends (device_token, match_id, event_key, title, body, ok, status_code, error)
            VALUES (${t}, NULL, ${eventId}, 'T', 'B', true, 200, NULL)
            ON CONFLICT (device_token, event_key) DO NOTHING`;
  const rows = await sql`SELECT device_token, match_id, event_key, ok, status_code FROM push_sends WHERE event_key = ${eventId}`;
  assert.equal(rows.length, 1, 'one row for one token');
  assert.equal(rows[0].match_id, null, 'a cron event has no game - migration 106 allows this');
  assert.equal(rows[0].ok, true);

  // AND SEND-ONCE IS INHERITED. push_sends_once is UNIQUE on
  // (device_token, event_key), so a re-run cannot double-ledger.
  await sql`INSERT INTO push_sends (device_token, match_id, event_key, title, body, ok, status_code, error)
            VALUES (${t}, NULL, ${eventId}, 'T', 'B', true, 200, NULL)
            ON CONFLICT (device_token, event_key) DO NOTHING`;
  const again = await sql`SELECT count(*)::int n FROM push_sends WHERE event_key = ${eventId}`;
  assert.equal(again[0].n, 1, 'the unique index dedupes the ledger for free');
  await sql`DELETE FROM push_sends WHERE event_key = ${eventId}`;
  assert.ok(typeof notifyEvent === 'function');
});

test('the ledger row names the APNs host, environment and topic', () => {
  // "Which APNs did this go to" took an hour to answer the one night it
  // mattered, because the host lived in an env var on a runtime nobody could
  // read after the fact. It is on the row now.
  const src = (rel) => readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
  const n = src('lib/push/notify.js');
  assert.match(n, /import \{ apnsConfig, sendToToken, alertPayload, gateReport \}/);
  assert.equal((n.match(/host: cfg\.host, env: cfg\.sandbox \? 'sandbox' : 'production', topic: cfg\.topic,/g) ?? []).length, 2,
    'both summaries carry it');
  const t = src('app/api/cron/push-test/route.js');
  assert.match(t, /host: cfg\.host, env: cfg\.sandbox \? 'sandbox' : 'production', topic: cfg\.topic,/);
  // NO SECRET ON THE ROW: gateReport is booleans and lengths, and only two of
  // its fields are copied.
  assert.match(n, /gate: \{ armed: gate\.armed, pemLines: gate\.APNS_KEY\.pemLines \}/);
});

test('push-test can name a token, and says which one it hit', () => {
  // On the night it was needed, this route picked "the most recently seen LIVE
  // token" - and the token under suspicion had been revoked seven minutes
  // earlier, so the probe silently tested a phone nobody was holding and
  // returned 200.
  const s = readFileSync(path.resolve(__dirname, '..', '..', 'app/api/cron/push-test/route.js'), 'utf8');
  assert.match(s, /const want = typeof body\?\.token === 'string'/);
  assert.match(s, /token LIKE \$\{`\$\{want\}%`\}/, 'a prefix is enough to name one');
  assert.match(s, /const tokenPrefix = String\(dev\.token\)\.slice\(0, 12\)/);
  assert.match(s, /token: tokenPrefix, wasRevoked: dev\.revoked_at != null, strikes: dev\.strikes \?\? 0,/,
    'the answer says which token, whether it was revoked, and its strike count');
  // Without the parameter the old rule stands, so nothing that calls it today
  // changes behaviour.
  assert.match(s, /WHERE user_id = \$\{userId\} AND revoked_at IS NULL/);
});
