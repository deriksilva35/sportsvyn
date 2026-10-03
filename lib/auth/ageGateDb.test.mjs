// lib/auth/ageGateDb.test.mjs - the age gate against DEV. node --test.
//
//   a new sign-up who is 13+ passes and can write;
//   an under-13 answer deletes the user row and everything that hangs off it,
//     and the date is never stored;
//   the refused browser (its cookie) refuses a retry with an ADULT date on the
//     next account sign-up makes;
//   an existing account with no date is prompted once, then never again.
//
// Sentinel users only (fixtureMark, @example.invalid); torn down in after().

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureMark, sweepStale } from '../testing/fixtureMark.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const { applyAnswer, ageGateRefusal, ageGateResponse, hasPassed, AGE_GATE_REFUSAL } = await import('./ageGateDb.js');
const { judgeAnswer } = await import('./ageGate.js');

const MARK = fixtureMark('agegatetest');
const NOW = new Date(Date.UTC(2026, 9, 3, 15));

async function wipe(like) {
  const users = await sql`SELECT id, email FROM users WHERE email LIKE ${like}`;
  for (const u of users) {
    await sql`DELETE FROM sessions WHERE "userId" = ${u.id}`;
    await sql`DELETE FROM accounts WHERE "userId" = ${u.id}`;
    await sql`DELETE FROM device_tokens WHERE user_id = ${u.id}`;
    await sql`DELETE FROM users WHERE id = ${u.id}`;
  }
  await sql`DELETE FROM email_otp WHERE identifier LIKE ${like}`;
  await sql`DELETE FROM email_signups WHERE email LIKE ${like}`;
  await sql`DELETE FROM verification_token WHERE identifier LIKE ${like}`;
}

before(async () => { await sweepStale(sql, MARK); await wipe(MARK.like); });
after(async () => {
  await wipe(MARK.like);
  const [{ n }] = await sql`SELECT count(*)::int n FROM users WHERE email LIKE ${MARK.like}`;
  assert.equal(n, 0, 'teardown left a sentinel user behind');
});

/** What a sign-up leaves: the user row (as emailOtp.js writes it) + a session. */
async function signUp(tag, { createdAt = null } = {}) {
  const email = MARK.email(tag);
  const [u] = createdAt
    ? await sql`INSERT INTO users (email, "emailVerified", created_at) VALUES (${email}, now(), ${createdAt}) RETURNING id, created_at`
    : await sql`INSERT INTO users (email, "emailVerified") VALUES (${email}, now()) RETURNING id, created_at`;
  await sql`INSERT INTO sessions ("sessionToken", "userId", expires) VALUES (${`agt-${u.id}`}, ${u.id}, now() + interval '30 days')`;
  return { id: u.id, email, createdAt: u.created_at };
}

const n = async (q) => (await q)[0].n;

test('a new sign-up who is 13 or older passes, once, and can then write', async () => {
  const u = await signUp('teen');
  // Before answering: every door refuses.
  assert.deepEqual(await ageGateRefusal(u.id, sql), AGE_GATE_REFUSAL);
  const res403 = await ageGateResponse(u.id, sql);
  assert.equal(res403.status, 403);
  assert.equal(await hasPassed(u.id, sql), false);

  // 13 today (3 Oct 2013 on 3 Oct 2026).
  const r = await applyAnswer(sql, { userId: u.id, email: u.email, createdAt: u.createdAt,
    fields: { month: '10', day: '3', year: '2013' }, now: NOW });
  assert.equal(r.outcome, 'stored');
  assert.equal(await ageGateRefusal(u.id, sql), null, 'the doors open');
  assert.equal(await hasPassed(u.id, sql), true);
  const [row] = await sql`SELECT date_of_birth::text d FROM users WHERE id = ${u.id}`;
  assert.equal(row.d, '2013-10-03');
});

test('UNDER 13: the user row and everything under it are deleted, and the date is never stored', async () => {
  const u = await signUp('kid');
  await sql`INSERT INTO accounts ("userId", type, provider, "providerAccountId") VALUES (${u.id}, 'oidc', 'apple', ${`agt-apple-${u.id}`})`;
  await sql`INSERT INTO device_tokens (token, user_id, platform) VALUES (${`agt${u.id}`.padEnd(64, 'a')}, ${u.id}, 'ios')`;
  await sql`INSERT INTO email_otp (identifier, token_hash, code_hash, expires) VALUES (${u.email}, ${`th-${u.id}`}, ${`ch-${u.id}`}, now() + interval '10 minutes')`;
  await sql`INSERT INTO verification_token (identifier, expires, token) VALUES (${u.email}, now() + interval '10 minutes', ${`vt-${u.id}`})`;
  await sql`INSERT INTO email_signups (email, source) VALUES (${u.email}, 'agegatetest')`;
  const team = (await sql`SELECT id FROM teams LIMIT 1`)[0];
  if (team) await sql`INSERT INTO user_team_follows (user_id, team_id) VALUES (${u.id}, ${team.id})`;

  // 12 years old: the 13th birthday is tomorrow.
  const r = await applyAnswer(sql, { userId: u.id, email: u.email, createdAt: u.createdAt,
    fields: { month: '10', day: '4', year: '2013' }, now: NOW });
  assert.deepEqual(r, { outcome: 'underage', deleted: true });

  assert.equal(await n(sql`SELECT count(*)::int n FROM users WHERE id = ${u.id}`), 0, 'user row gone');
  assert.equal(await n(sql`SELECT count(*)::int n FROM sessions WHERE "userId" = ${u.id}`), 0, 'signed out: sessions gone');
  assert.equal(await n(sql`SELECT count(*)::int n FROM accounts WHERE "userId" = ${u.id}`), 0, 'Apple link gone');
  assert.equal(await n(sql`SELECT count(*)::int n FROM device_tokens WHERE user_id = ${u.id}`), 0, 'device token gone, not nulled');
  assert.equal(await n(sql`SELECT count(*)::int n FROM device_tokens WHERE token = ${`agt${u.id}`.padEnd(64, 'a')}`), 0);
  assert.equal(await n(sql`SELECT count(*)::int n FROM user_team_follows WHERE user_id = ${u.id}`), 0, 'cascade');
  assert.equal(await n(sql`SELECT count(*)::int n FROM email_otp WHERE identifier = ${u.email}`), 0);
  assert.equal(await n(sql`SELECT count(*)::int n FROM verification_token WHERE identifier = ${u.email}`), 0);
  assert.equal(await n(sql`SELECT count(*)::int n FROM email_signups WHERE email = ${u.email}`), 0);
  // And nothing anywhere holds the date that was entered.
  assert.equal(await n(sql`SELECT count(*)::int n FROM users WHERE date_of_birth = '2013-10-04' AND email LIKE ${MARK.like}`), 0);
});

test('THE REFUSED BROWSER: its cookie refuses a retry with an adult date', async () => {
  // Same browser, after the refusal: a new sign-up, and this time an adult
  // date. The action passes blocked=true because the sv_age_block cookie (or
  // the device flag) is present; nothing about the new date is believed.
  assert.equal(judgeAnswer({ month: '1', day: '1', year: '1985' }, { blocked: true, now: NOW }).ok, false);
  const u = await signUp('retry');
  const r = await applyAnswer(sql, { userId: u.id, email: u.email, createdAt: u.createdAt,
    fields: { month: '1', day: '1', year: '1985' }, blocked: true, now: NOW });
  assert.deepEqual(r, { outcome: 'underage', deleted: true }, 'the account sign-up just made is not kept');
  assert.equal(await n(sql`SELECT count(*)::int n FROM users WHERE id = ${u.id}`), 0);
  assert.equal(await n(sql`SELECT count(*)::int n FROM users WHERE date_of_birth = '1985-01-01' AND email LIKE ${MARK.like}`), 0,
    'the adult date from a refused browser is never stored');
});

test('a blocked retry on an OLD account signs it out but does not delete it', async () => {
  // A parent's long-standing account on a shared browser: refused, signed out,
  // still unable to play - but not destroyed by a child's answer.
  const u = await signUp('oldshared', { createdAt: '2025-08-01T00:00:00Z' });
  const r = await applyAnswer(sql, { userId: u.id, email: u.email, createdAt: u.createdAt,
    fields: { month: '1', day: '1', year: '1980' }, blocked: true, now: NOW });
  assert.deepEqual(r, { outcome: 'underage', deleted: false });
  assert.equal(await n(sql`SELECT count(*)::int n FROM users WHERE id = ${u.id} AND date_of_birth IS NULL`), 1);
  assert.equal(await n(sql`SELECT count(*)::int n FROM sessions WHERE "userId" = ${u.id}`), 0, 'signed out');
  assert.deepEqual(await ageGateRefusal(u.id, sql), AGE_GATE_REFUSAL, 'still cannot play');
});

test('an EXISTING account with no date is prompted once, then never again', async () => {
  const u = await signUp('existing', { createdAt: '2025-08-01T00:00:00Z' });
  // Next visit: not passed -> /age/check sends it to the form.
  assert.equal(await hasPassed(u.id, sql), false);
  assert.deepEqual(await ageGateRefusal(u.id, sql), AGE_GATE_REFUSAL);
  const r1 = await applyAnswer(sql, { userId: u.id, email: u.email, createdAt: u.createdAt,
    fields: { month: '6', day: '15', year: '1990' }, now: NOW });
  assert.equal(r1.outcome, 'stored');
  // Every later visit: passed, so /age/check sets the marker and moves on.
  assert.equal(await hasPassed(u.id, sql), true);
  // A second submission (a stale tab) changes nothing.
  const r2 = await applyAnswer(sql, { userId: u.id, email: u.email, createdAt: u.createdAt,
    fields: { month: '1', day: '1', year: '2000' }, now: NOW });
  assert.deepEqual(r2, { outcome: 'stored', already: true });
  const [row] = await sql`SELECT date_of_birth::text d FROM users WHERE id = ${u.id}`;
  assert.equal(row.d, '1990-06-15', 'the first answer stands');
});

test('an invalid date writes nothing and keeps the account', async () => {
  const u = await signUp('typo');
  const r = await applyAnswer(sql, { userId: u.id, email: u.email, createdAt: u.createdAt,
    fields: { month: '2', day: '31', year: '1990' }, now: NOW });
  assert.deepEqual(r, { outcome: 'invalid', reason: 'invalid' });
  assert.equal(await n(sql`SELECT count(*)::int n FROM users WHERE id = ${u.id} AND date_of_birth IS NULL`), 1);
});

test('signed out is not the gate\'s business; a failed read refuses', async () => {
  assert.equal(await ageGateRefusal(null, sql), null);
  const broken = () => Promise.reject(new Error('down'));
  assert.deepEqual(await ageGateRefusal(1, broken), AGE_GATE_REFUSAL, 'fails closed');
});
