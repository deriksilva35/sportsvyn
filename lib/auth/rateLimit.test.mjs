// lib/auth/rateLimit.test.mjs - sign-in email caps and the per-email wrong-code
// window (RULING sun-12 item 2), against the DEV DB.
//
// SENTINELS: every identifier ends in @ratelimit.test and every IP is in
// 198.51.100.0/24 (TEST-NET-2, never a real client). before() and after() delete
// exactly those, and after() ASSERTS that nothing carrying them is left in
// auth_throttle, email_otp, verification_token, users or sessions.
//
// The windows are tested by moving the clock (`now`), never by waiting.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
})(path.join(REPO, '.env.local'));

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const {
  AUTH_LIMITS, clientIp, reserveSend, reserveSendSafe, recordFailure, failureState, clearFailures,
} = await import('./rateLimit.js');
const { redeemEmailCode, attachCode, sha256, MAX_ATTEMPTS } = await import('./emailOtp.js');

const MARK = '%@ratelimit.test';
const IP_MARK = '198.51.100.%';
const SECRET = 'test-secret-ratelimit';
const ident = (tag) => `rl-${tag}@ratelimit.test`;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

async function cleanup() {
  await sql`DELETE FROM auth_throttle WHERE identifier LIKE ${MARK} OR ip LIKE ${IP_MARK}`;
  await sql`DELETE FROM sessions WHERE "userId" IN (SELECT id FROM users WHERE email LIKE ${MARK})`;
  await sql`DELETE FROM users WHERE email LIKE ${MARK}`;
  await sql`DELETE FROM verification_token WHERE identifier LIKE ${MARK}`;
  await sql`DELETE FROM email_otp WHERE identifier LIKE ${MARK}`;
}

before(cleanup);
after(async () => {
  await cleanup();
  const [r] = await sql`
    SELECT
      (SELECT count(*)::int FROM auth_throttle WHERE identifier LIKE ${MARK} OR ip LIKE ${IP_MARK}) AS throttle,
      (SELECT count(*)::int FROM email_otp WHERE identifier LIKE ${MARK}) AS otp,
      (SELECT count(*)::int FROM verification_token WHERE identifier LIKE ${MARK}) AS vt,
      (SELECT count(*)::int FROM users WHERE email LIKE ${MARK}) AS users`;
  assert.deepEqual(r, { throttle: 0, otp: 0, vt: 0, users: 0 }, 'teardown left sentinel rows behind');
});

// A token + code exactly as auth.js stores them (attachCode is the real writer).
async function seedCode(identifier, rawToken, code) {
  const tokenHash = sha256(rawToken, SECRET);
  const expires = new Date(Date.now() + 600_000);
  await sql`INSERT INTO verification_token (identifier, token, expires) VALUES (${identifier}, ${tokenHash}, ${expires.toISOString()})`;
  await attachCode(sql, { identifier, tokenHash, codeHash: sha256(code, SECRET), expires });
  return tokenHash;
}
const wrong = (email) => redeemEmailCode(sql, { email, code: '000000', secret: SECRET });

// ---------------------------------------------------------------------------
// the numbers
// ---------------------------------------------------------------------------

test('the caps live in ONE config, with the ruled numbers', () => {
  assert.equal(AUTH_LIMITS.SEND_PER_EMAIL.max, 5);
  assert.equal(AUTH_LIMITS.SEND_PER_EMAIL.windowMs, HOUR);
  assert.equal(AUTH_LIMITS.SEND_PER_IP.max, 20);
  assert.equal(AUTH_LIMITS.SEND_PER_IP.windowMs, HOUR);
  assert.equal(AUTH_LIMITS.FAIL_PER_EMAIL.max, 10);
  assert.equal(AUTH_LIMITS.FAIL_PER_EMAIL.windowMs, 24 * HOUR);
  assert.equal(MAX_ATTEMPTS, 5, 'the per-code limit is kept');
  assert.ok(Object.isFrozen(AUTH_LIMITS) && Object.isFrozen(AUTH_LIMITS.SEND_PER_EMAIL));
});

test('clientIp: x-forwarded-for first hop, then x-real-ip, else null', () => {
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' })), '198.51.100.7');
  assert.equal(clientIp(new Headers({ 'x-forwarded-for': '198.51.100.7', 'x-real-ip': '198.51.100.9' })), '198.51.100.7');
  assert.equal(clientIp(new Headers({ 'x-real-ip': '198.51.100.9' })), '198.51.100.9');
  assert.equal(clientIp({ 'x-real-ip': '198.51.100.9' }), '198.51.100.9');
  assert.equal(clientIp(new Headers()), null);
  assert.equal(clientIp(undefined), null);
});

// ---------------------------------------------------------------------------
// per-email send cap
// ---------------------------------------------------------------------------

test('per email: 5 sends in an hour go out, the 6th is refused, the 61st minute is allowed again', async () => {
  const id = ident('cap');
  const T = Date.now() - 3 * HOUR;
  // sends at minutes 0, 10, 20, 30, 40
  for (let k = 0; k < 5; k++) {
    const r = await reserveSend(sql, { identifier: id, now: new Date(T + k * 10 * MIN) });
    assert.deepEqual(r, { ok: true }, `send ${k + 1} allowed`);
  }
  const sixth = await reserveSend(sql, { identifier: id, now: new Date(T + 50 * MIN) });
  assert.deepEqual(sixth, { ok: false, reason: 'email' });
  // hammering a capped address does not push its recovery out: refused rows don't count
  for (let m = 51; m < 56; m++) {
    assert.equal((await reserveSend(sql, { identifier: id, now: new Date(T + m * MIN) })).ok, false);
  }
  // just before minute 60 the minute-0 send is still inside the hour
  assert.equal((await reserveSend(sql, { identifier: id, now: new Date(T + 60 * MIN - 1) })).ok, false);
  // minute 61: the minute-0 send has left the window -> 4 in the hour -> allowed
  assert.deepEqual(await reserveSend(sql, { identifier: id, now: new Date(T + 61 * MIN) }), { ok: true });
  // and that one used the freed slot (10, 20, 30, 40, 61)
  assert.equal((await reserveSend(sql, { identifier: id, now: new Date(T + 62 * MIN) })).ok, false);
  // case and whitespace do not make a new address
  assert.equal((await reserveSend(sql, { identifier: `  ${id.toUpperCase()} `, now: new Date(T + 63 * MIN) })).ok, false);
});

test('per email: signup confirmations and sign-in codes share the budget', async () => {
  const id = ident('shared');
  const T = Date.now() - 2 * HOUR;
  for (let m = 0; m < 3; m++) assert.equal((await reserveSend(sql, { identifier: id, purpose: 'signin', now: new Date(T + m * MIN) })).ok, true);
  for (let m = 3; m < 5; m++) assert.equal((await reserveSend(sql, { identifier: id, purpose: 'signup_confirm', now: new Date(T + m * MIN) })).ok, true);
  assert.deepEqual(await reserveSend(sql, { identifier: id, purpose: 'signup_confirm', now: new Date(T + 6 * MIN) }), { ok: false, reason: 'email' });
});

// ---------------------------------------------------------------------------
// per-IP send cap
// ---------------------------------------------------------------------------

test('per IP: 20 sends to 20 addresses in an hour, the 21st is refused; another IP is not', async () => {
  const ip = '198.51.100.21';
  const T = Date.now() - 2 * HOUR;
  for (let i = 0; i < 20; i++) {
    const r = await reserveSend(sql, { identifier: ident(`ip${i}`), ip, now: new Date(T + i * 1000) });
    assert.deepEqual(r, { ok: true }, `address ${i + 1} allowed`);
  }
  const t21 = new Date(T + 30 * 1000);
  assert.deepEqual(await reserveSend(sql, { identifier: ident('ip20'), ip, now: t21 }), { ok: false, reason: 'ip' });
  // a fresh address from another IP is untouched
  assert.deepEqual(await reserveSend(sql, { identifier: ident('ip-other'), ip: '198.51.100.22', now: t21 }), { ok: true });
  // and the IP recovers after the hour
  assert.deepEqual(await reserveSend(sql, { identifier: ident('ip21'), ip, now: new Date(T + HOUR + 2000) }), { ok: true });
});

test('a ledger failure FAILS OPEN (logged), so a database blip never blocks sign-in', async () => {
  const broken = async () => { throw new Error('relation "auth_throttle" does not exist'); };
  const orig = console.error; console.error = () => {};
  try {
    assert.equal((await reserveSendSafe(broken, { identifier: ident('open') })).ok, true);
  } finally { console.error = orig; }
});

// ---------------------------------------------------------------------------
// wrong codes: per email, not per code
// ---------------------------------------------------------------------------

test('a NEW code does not reset the wrong-attempt count; the 10th wrong in 24h locks', async () => {
  const id = ident('noreset');
  // code A: 4 wrong (per-code remaining 1)
  await seedCode(id, 'tok-a', '111111');
  for (let i = 0; i < 4; i++) assert.equal((await wrong(id)).reason, 'wrong');
  // re-attaching the SAME token does not hand back its spent tries
  const tokA = sha256('tok-a', SECRET);
  await attachCode(sql, { identifier: id, tokenHash: tokA, codeHash: sha256('111111', SECRET), expires: new Date(Date.now() + 600_000) });
  assert.equal((await sql`SELECT attempts FROM email_otp WHERE identifier = ${id} AND token_hash = ${tokA}`)[0].attempts, 4);
  await sql`DELETE FROM verification_token WHERE identifier = ${id}`;
  await sql`DELETE FROM email_otp WHERE identifier = ${id}`;

  // code B (a new send): 4 more wrong. The count carries over.
  await seedCode(id, 'tok-b', '222222');
  for (let i = 0; i < 4; i++) assert.equal((await wrong(id)).reason, 'wrong');
  assert.equal((await failureState(sql, { identifier: id })).count, 8, 'new code B did not start from zero');
  await sql`DELETE FROM verification_token WHERE identifier = ${id}`;
  await sql`DELETE FROM email_otp WHERE identifier = ${id}`;

  // code C: its own 5 tries are untouched, but the WINDOW has 2 left - and the
  // remaining count the user is told is the smaller one.
  await seedCode(id, 'tok-c', '333333');
  const ninth = await wrong(id);
  assert.equal(ninth.reason, 'wrong');
  assert.equal(ninth.remaining, 1, 'remaining = min(per-code 4, per-email 1)');
  const tenth = await wrong(id);
  assert.equal(tenth.reason, 'locked');
  assert.ok(tenth.unlocksAt instanceof Date);
  assert.equal((await sql`SELECT count(*)::int n FROM email_otp WHERE identifier = ${id}`)[0].n, 0, 'the code is spent');

  // while locked, even a CORRECT code on a fresh send is refused - and the
  // refused attempt is not counted
  await seedCode(id, 'tok-d', '444444');
  const correct = await redeemEmailCode(sql, { email: id, code: '444444', secret: SECRET });
  assert.equal(correct.ok, false);
  assert.equal(correct.reason, 'locked');
  assert.equal((await failureState(sql, { identifier: id })).count, 10);
  assert.equal((await sql`SELECT count(*)::int n FROM users WHERE email = ${id}`)[0].n, 0, 'no account, no session');
});

test('lockout lasts until the window passes, then the user recovers', async () => {
  const id = ident('recover');
  const T = Date.now() - 30 * HOUR;
  for (let i = 0; i < 10; i++) await recordFailure(sql, { identifier: id, now: new Date(T + i * MIN) });
  const during = await failureState(sql, { identifier: id, now: new Date(T + 12 * HOUR) });
  assert.equal(during.locked, true);
  assert.equal(during.unlocksAt.getTime(), T + 24 * HOUR, 'unlocks when the oldest of the 10 is 24h old');
  // one minute short of the window: still locked
  assert.equal((await failureState(sql, { identifier: id, now: new Date(T + 24 * HOUR - 1) })).locked, true);
  // the oldest has aged out -> 9 -> unlocked, with one try left in the window
  const afterW = await failureState(sql, { identifier: id, now: new Date(T + 24 * HOUR + 1) });
  assert.equal(afterW.locked, false);
  assert.equal(afterW.remaining, 1);

  // End to end at the real clock (those failures are now 21-30h old, outside
  // the window): the correct code signs in, and success clears the count.
  await seedCode(id, 'tok-r', '555555');
  const ok = await redeemEmailCode(sql, { email: id, code: '555555', secret: SECRET });
  assert.equal(ok.ok, true);
  assert.equal((await sql`SELECT count(*)::int n FROM auth_throttle WHERE kind = 'fail' AND identifier = ${id}`)[0].n, 0);
});

test('a locked address at the real clock refuses the code; one a day older does not', async () => {
  const locked = ident('locked-now');
  for (let i = 0; i < 10; i++) await recordFailure(sql, { identifier: locked, now: new Date(Date.now() - HOUR + i * MIN) });
  await seedCode(locked, 'tok-l', '666666');
  const r = await redeemEmailCode(sql, { email: locked, code: '666666', secret: SECRET });
  assert.equal(r.reason, 'locked');
  // a mistyping user (some failures, under 10) still gets in with the right code
  const typo = ident('typo');
  for (let i = 0; i < 9; i++) await recordFailure(sql, { identifier: typo, now: new Date(Date.now() - HOUR + i * MIN) });
  await seedCode(typo, 'tok-t', '777777');
  assert.equal((await redeemEmailCode(sql, { email: typo, code: '777777', secret: SECRET })).ok, true);
  await clearFailures(sql, { identifier: locked });
  assert.equal((await failureState(sql, { identifier: locked })).count, 0);
});

// ---------------------------------------------------------------------------
// wiring, and what is NOT throttled
// ---------------------------------------------------------------------------

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const authSrc = stripComments(readFileSync(path.join(REPO, 'auth.js'), 'utf8'));

test('the sign-in send is gated BEFORE the code is made or the mail goes out', () => {
  const fn = authSrc.slice(authSrc.indexOf('async sendVerificationRequest'));
  const gate = fn.indexOf('reserveSendSafe(');
  assert.ok(gate > 0, 'sendVerificationRequest calls the cap');
  assert.ok(gate < fn.indexOf('generateCode()') && gate < fn.indexOf('resend.emails.send'), 'cap first');
  assert.match(fn, /purpose: 'signin'/);
  assert.match(fn, /clientIp\(request\?\.headers\)/, 'the IP comes from the request Auth.js hands the provider');
  assert.match(fn, /throw new SendThrottled\(\)/);
});

test('Apple sign-in is unaffected: no cap or lock anywhere on its path', () => {
  assert.equal((authSrc.match(/reserveSendSafe\(/g) || []).length, 1, 'one call site, the Resend provider');
  const resendBlock = authSrc.slice(authSrc.indexOf('Resend({'), authSrc.indexOf('if (appleConfigured())'));
  assert.ok(resendBlock.includes('reserveSendSafe('), 'the call site is inside the Resend provider');
  const appleBlock = authSrc.slice(authSrc.indexOf('if (appleConfigured())'), authSrc.indexOf('const baseAdapter'));
  assert.match(appleBlock, /Apple\(\{/);
  for (const banned of ['reserveSend', 'failureState', 'recordFailure', 'SendThrottled', 'redeemEmailCode']) {
    assert.ok(!appleBlock.includes(banned), `Apple provider must not touch ${banned}`);
  }
  // the adapter + events (Apple's account creation/linking) never reach the ledger
  const rest = authSrc.slice(authSrc.indexOf('const baseAdapter'));
  assert.ok(!/reserveSend|failureState|recordFailure|auth_throttle/.test(rest));
  // and the OTP module, the only place the lock lives, is not on the Apple path
  assert.ok(!/redeemEmailCode/.test(authSrc));
});

test('a capped send reaches the client as AccessDenied, shown as ONE generic line', async () => {
  const { SendThrottled } = await import('./sendThrottled.js');
  const { isClientError } = await import('@auth/core/errors');
  const e = new SendThrottled();
  assert.equal(e.type, 'AccessDenied');
  assert.equal(isClientError(e), true, 'otherwise Auth.js reports it as Configuration');
  const form = readFileSync(path.join(REPO, 'app/signin/SignInForm.js'), 'utf8');
  const line = form.match(/const THROTTLED = "([^"]+)"/)?.[1];
  assert.ok(line, 'the throttled message is a constant');
  assert.ok(!/account|registered|exist/i.test(line), 'it says nothing about whether an account exists');
  assert.match(form, /res\?\.error === 'AccessDenied' \? 'throttled'/);
  assert.match(form, /locked:\s+'Too many wrong codes for this email/);
});

test('the homepage signup confirmation is capped by the same ledger, silently', () => {
  const route = stripComments(readFileSync(path.join(REPO, 'app/api/email/signup/route.js'), 'utf8'));
  assert.match(route, /reserveSendSafe\(sql, \{ identifier: email, ip, purpose: 'signup_confirm' \}\)/);
  assert.match(route, /if \(await mayConfirm\(normalizedEmail, ip\)\) await sendConfirmation/);
  // the resend path checks the cap BEFORE rotating the token
  const dupe = route.slice(route.indexOf("err?.code === '23505'"));
  assert.ok(dupe.indexOf('mayConfirm(') < dupe.indexOf('UPDATE email_signups'));
  assert.equal((route.match(/sendConfirmation\(normalizedEmail/g) || []).length, 2, 'both sends are behind the gate');
});
