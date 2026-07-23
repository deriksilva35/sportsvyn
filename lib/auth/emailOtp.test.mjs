// Integration tests for lib/auth/emailOtp.js against the DEV DB (email_otp +
// verification_token + users/sessions). Loads .env.local (repo convention) then
// dynamic-imports. All test rows use the @otp.test marker and are cleaned up.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const { redeemEmailCode, sha256, MAX_ATTEMPTS } = await import('./emailOtp.js');

const SECRET = 'test-secret-emailotp';
const MARK = '%@otp.test';
const ident = (tag) => `otp-${tag}@otp.test`;

async function cleanup() {
  await sql`DELETE FROM sessions WHERE "userId" IN (SELECT id FROM users WHERE email LIKE ${MARK})`;
  await sql`DELETE FROM users WHERE email LIKE ${MARK}`;
  await sql`DELETE FROM verification_token WHERE identifier LIKE ${MARK}`;
  await sql`DELETE FROM email_otp WHERE identifier LIKE ${MARK}`;
}

// Seed a token + its OTP (token_hash = sha256(rawToken+secret) mirrors what
// auth.js stores). Returns the token_hash.
async function seed({ identifier, rawToken, code, expiresMs = 600_000, attempts = 0 }) {
  const tokenHash = sha256(rawToken, SECRET);
  const codeHash = sha256(code, SECRET);
  const expires = new Date(Date.now() + expiresMs).toISOString();
  await sql`INSERT INTO verification_token (identifier, token, expires) VALUES (${identifier}, ${tokenHash}, ${expires}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO email_otp (identifier, token_hash, code_hash, expires, attempts)
            VALUES (${identifier}, ${tokenHash}, ${codeHash}, ${expires}, ${attempts})
            ON CONFLICT (identifier, token_hash) DO UPDATE SET code_hash=EXCLUDED.code_hash, expires=EXCLUDED.expires, attempts=EXCLUDED.attempts`;
  return tokenHash;
}
const tokenRows = (id) => sql`SELECT count(*)::int n FROM verification_token WHERE identifier = ${id}`;
const otpRows = (id) => sql`SELECT count(*)::int n FROM email_otp WHERE identifier = ${id}`;

before(cleanup);
beforeEach(cleanup);
after(cleanup);

test('correct code signs in: creates a session and consumes the token (single-use)', async () => {
  const id = ident('single');
  await seed({ identifier: id, rawToken: 'rawtok-single', code: '123456' });
  const res = await redeemEmailCode(sql, { email: id, code: '123456', secret: SECRET });
  assert.equal(res.ok, true);
  assert.ok(res.sessionToken && res.userId);
  // session row exists for the created user
  const sess = await sql`SELECT count(*)::int n FROM sessions WHERE "sessionToken" = ${res.sessionToken}`;
  assert.equal(sess[0].n, 1);
  // both token rows consumed
  assert.equal((await tokenRows(id))[0].n, 0);
  assert.equal((await otpRows(id))[0].n, 0);
  // second use fails (single-use)
  const again = await redeemEmailCode(sql, { email: id, code: '123456', secret: SECRET });
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'invalid');
});

test('expired code is rejected', async () => {
  const id = ident('expired');
  await seed({ identifier: id, rawToken: 'rawtok-exp', code: '222222', expiresMs: -1000 });
  const res = await redeemEmailCode(sql, { email: id, code: '222222', secret: SECRET });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'invalid');
});

test('5 wrong attempts invalidates the token', async () => {
  const id = ident('attempts');
  await seed({ identifier: id, rawToken: 'rawtok-att', code: '333333' });
  for (let i = 1; i <= MAX_ATTEMPTS - 1; i++) {
    const r = await redeemEmailCode(sql, { email: id, code: '000000', secret: SECRET });
    assert.equal(r.reason, 'wrong');
    assert.equal(r.remaining, MAX_ATTEMPTS - i);
  }
  // 5th wrong attempt -> too_many + token invalidated
  const fifth = await redeemEmailCode(sql, { email: id, code: '000000', secret: SECRET });
  assert.equal(fifth.reason, 'too_many');
  assert.equal((await tokenRows(id))[0].n, 0);
  assert.equal((await otpRows(id))[0].n, 0);
  // even the CORRECT code no longer works (token gone)
  const correct = await redeemEmailCode(sql, { email: id, code: '333333', secret: SECRET });
  assert.equal(correct.ok, false);
});

test('redeeming the code consumes the underlying verification token', async () => {
  const id = ident('codefirst');
  const tokenHash = await seed({ identifier: id, rawToken: 'rawtok-cf', code: '444444' });
  const res = await redeemEmailCode(sql, { email: id, code: '444444', secret: SECRET });
  assert.equal(res.ok, true);
  // the verification_token is gone (single source of truth consumed)
  const link = await sql`SELECT count(*)::int n FROM verification_token WHERE identifier = ${id} AND token = ${tokenHash}`;
  assert.equal(link[0].n, 0);
});

test('an already-consumed (absent) token cannot be redeemed by the code', async () => {
  const id = ident('linkfirst');
  const tokenHash = await seed({ identifier: id, rawToken: 'rawtok-lf', code: '555555' });
  // simulate the verification_token being gone (consumed/expired-cleaned)
  await sql`DELETE FROM verification_token WHERE identifier = ${id} AND token = ${tokenHash}`;
  const res = await redeemEmailCode(sql, { email: id, code: '555555', secret: SECRET });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'invalid'); // cross-check: token gone -> code spent
});

test('wrong-length / non-numeric code is rejected without touching the token', async () => {
  const id = ident('badinput');
  await seed({ identifier: id, rawToken: 'rawtok-bad', code: '666666' });
  const r = await redeemEmailCode(sql, { email: id, code: '12', secret: SECRET });
  assert.equal(r.reason, 'invalid');
  assert.equal((await otpRows(id))[0].n, 1); // untouched
});
