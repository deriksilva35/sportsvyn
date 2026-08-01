// Pure unit tests for the isMember() date logic (membershipRowIsActive). No DB
// query runs, but importing membership.js pulls in db.js, which requires
// DATABASE_URL at load — so we load .env.local first (repo test convention,
// mirrors drafts.test.mjs) and dynamic-import after. The predicate itself is pure.
import { test } from 'node:test';
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
})(path.resolve(__dirname, '..', '.env.local'));

const {
  membershipRowIsActive, entitlementsFromRow, getEntitlements,
  upsertPassForUser, tierFromLookupKey, DRAFT_PASS_EXPIRES_AT,
  grantApplePass, revokeApplePass, recordIgnoredRevenueCatEvent,
} = await import('./membership.js');
const { sql } = await import('./db.js');

const NOW = new Date('2026-07-22T00:00:00Z');
const future = new Date('2026-08-22T00:00:00Z').toISOString();
const past = new Date('2026-06-22T00:00:00Z').toISOString();

test('no row -> not a member', () => {
  assert.equal(membershipRowIsActive(null, NOW), false);
  assert.equal(membershipRowIsActive(undefined, NOW), false);
});

test('active with future period end -> member', () => {
  assert.equal(membershipRowIsActive({ status: 'active', current_period_end: future }, NOW), true);
});

test('trialing with future period end -> member', () => {
  assert.equal(membershipRowIsActive({ status: 'trialing', current_period_end: future }, NOW), true);
});

test('active but period end in the past -> not a member', () => {
  assert.equal(membershipRowIsActive({ status: 'active', current_period_end: past }, NOW), false);
});

test('canceled / past_due / incomplete -> not a member regardless of period', () => {
  assert.equal(membershipRowIsActive({ status: 'canceled', current_period_end: future }, NOW), false);
  assert.equal(membershipRowIsActive({ status: 'past_due', current_period_end: future }, NOW), false);
  assert.equal(membershipRowIsActive({ status: 'incomplete', current_period_end: future }, NOW), false);
});

test('active with null period end -> member (just-created subscription)', () => {
  assert.equal(membershipRowIsActive({ status: 'active', current_period_end: null }, NOW), true);
});

// ---- entitlement matrix (entitlementsFromRow — pure two-level resolver) ----
test('entitlements: no row -> nothing', () => {
  assert.deepEqual(entitlementsFromRow(null, NOW), { sim: false, suite: false });
});
test('entitlements: active suite sub -> sim + suite', () => {
  assert.deepEqual(entitlementsFromRow({ kind: 'subscription', tier: 'suite', status: 'active', current_period_end: future }, NOW), { sim: true, suite: true });
});
test('entitlements: active founding sub -> sim + suite', () => {
  assert.deepEqual(entitlementsFromRow({ kind: 'subscription', tier: 'founding', status: 'active', current_period_end: future }, NOW), { sim: true, suite: true });
});
test('entitlements: legacy null-tier active sub -> sim only', () => {
  assert.deepEqual(entitlementsFromRow({ kind: null, tier: null, status: 'active', current_period_end: future }, NOW), { sim: true, suite: false });
});
test('entitlements: expired sub -> nothing', () => {
  assert.deepEqual(entitlementsFromRow({ kind: 'subscription', tier: 'suite', status: 'active', current_period_end: past }, NOW), { sim: false, suite: false });
});
test('entitlements: unexpired pass -> sim only (never suite)', () => {
  assert.deepEqual(entitlementsFromRow({ kind: 'pass', tier: 'pass', expires_at: future }, NOW), { sim: true, suite: false });
});
test('entitlements: expired pass -> nothing', () => {
  assert.deepEqual(entitlementsFromRow({ kind: 'pass', tier: 'pass', expires_at: past }, NOW), { sim: false, suite: false });
});
test('entitlements: canceled sub -> nothing regardless of tier/period', () => {
  assert.deepEqual(entitlementsFromRow({ kind: 'subscription', tier: 'suite', status: 'canceled', current_period_end: future }, NOW), { sim: false, suite: false });
});

test('tierFromLookupKey maps suite/founding, null for legacy', () => {
  assert.equal(tierFromLookupKey('sportsvyn_suite'), 'suite');
  assert.equal(tierFromLookupKey('sportsvyn_founding'), 'founding');
  assert.equal(tierFromLookupKey('sportsvyn_annual'), null);
  assert.equal(tierFromLookupKey(null), null);
});

// ---- webhook payment branch idempotency (DB-backed, DEV; temp user) ----
test('upsertPassForUser is idempotent: redelivery -> one row, fixed expiry', async () => {
  const uid = (await sql`INSERT INTO users DEFAULT VALUES RETURNING id`)[0].id;
  try {
    await upsertPassForUser(uid, { stripeCustomerId: 'cus_test', expiresAt: DRAFT_PASS_EXPIRES_AT });
    await upsertPassForUser(uid, { stripeCustomerId: 'cus_test', expiresAt: DRAFT_PASS_EXPIRES_AT }); // Stripe redelivery
    const rows = await sql`SELECT kind, tier, status, expires_at FROM memberships WHERE user_id = ${uid}`;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, 'pass');
    assert.equal(rows[0].tier, 'pass');
    assert.equal(rows[0].status, 'active');
    assert.equal(new Date(rows[0].expires_at).toISOString(), DRAFT_PASS_EXPIRES_AT);
    assert.deepEqual(await getEntitlements(uid), { sim: true, suite: false });
  } finally {
    await sql`DELETE FROM users WHERE id = ${uid}`; // cascade removes the membership row
  }
});

// ---------------------------------------------------------------------------
// ENTITLEMENT PARITY — source is provenance, never a gate (migration 056)
// ---------------------------------------------------------------------------

test('entitlements are SOURCE-BLIND: an Apple pass grants what a Stripe pass grants', () => {
  // The whole design rests on this. If entitlementsFromRow ever started reading
  // `source`, an Apple customer and a Stripe customer holding the same product
  // would get different access - and the Apple one paid Apple's 30% for it.
  const apple = { kind: 'pass', tier: 'pass', expires_at: future, source: 'apple' };
  const stripe = { kind: 'pass', tier: 'pass', expires_at: future, source: 'stripe' };
  assert.deepEqual(entitlementsFromRow(apple, NOW), entitlementsFromRow(stripe, NOW));
  assert.deepEqual(entitlementsFromRow(apple, NOW), { sim: true, suite: false });
  // Expiry governs both identically.
  assert.deepEqual(
    entitlementsFromRow({ ...apple, expires_at: past }, NOW),
    entitlementsFromRow({ ...stripe, expires_at: past }, NOW),
  );
  // A row with no source at all (pre-056 shape) is unchanged.
  assert.deepEqual(entitlementsFromRow({ kind: 'pass', tier: 'pass', expires_at: future }, NOW), { sim: true, suite: false });
});

test('the resolver does not read the source column at all', () => {
  // Cheap structural proof to go with the behavioural one above.
  const s = readFileSync(path.join(__dirname, 'membership.js'), 'utf8');
  const slice = s.slice(s.indexOf('export function entitlementsFromRow'), s.indexOf('export async function getEntitlements'));
  // Comments stripped: the prose between these two functions says "the single
  // source the gates flip off", which is about entitlement, not the column.
  const fn = slice.replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/\bsource\b/.test(fn), 'entitlementsFromRow references source');
});

// ---------------------------------------------------------------------------
// APPLE IAP WRITERS (DB-backed, DEV; temp user, cascade cleanup)
// ---------------------------------------------------------------------------

const rcEvent = (over = {}) => ({
  id: `rc_test_${Math.random().toString(36).slice(2)}`,
  type: 'NON_RENEWING_PURCHASE',
  appUserId: null,
  userId: null,
  productId: 'com.sportsvyn.draftvyn.pass',
  environment: 'SANDBOX',
  ...over,
});

async function withTempUser(fn) {
  const uid = (await sql`INSERT INTO users DEFAULT VALUES RETURNING id`)[0].id;
  try { return await fn(uid); }
  finally { await sql`DELETE FROM users WHERE id = ${uid}`; } // cascades to memberships + revenuecat_events
}

test('grantApplePass writes an apple-sourced pass with the Stripe pass entitlement', async () => {
  await withTempUser(async (uid) => {
    const ev = rcEvent({ userId: uid, appUserId: String(uid) });
    assert.equal(await grantApplePass(ev), uid);
    const [row] = await sql`SELECT kind, tier, status, source, expires_at FROM memberships WHERE user_id = ${uid}`;
    assert.equal(row.kind, 'pass');
    assert.equal(row.tier, 'pass');
    assert.equal(row.status, 'active');
    assert.equal(row.source, 'apple');
    assert.equal(new Date(row.expires_at).toISOString(), DRAFT_PASS_EXPIRES_AT);
    assert.deepEqual(await getEntitlements(uid), { sim: true, suite: false });
  });
});

test('a redelivered event is a no-op (idempotent per event id)', async () => {
  await withTempUser(async (uid) => {
    const ev = rcEvent({ userId: uid, appUserId: String(uid) });
    assert.equal(await grantApplePass(ev), uid);
    assert.equal(await grantApplePass(ev), null, 'the redelivery applied a second time');
    const rows = await sql`SELECT count(*)::int c FROM memberships WHERE user_id = ${uid}`;
    assert.equal(rows[0].c, 1);
    const led = await sql`SELECT count(*)::int c FROM revenuecat_events WHERE event_id = ${ev.id}`;
    assert.equal(led[0].c, 1, 'the ledger recorded the same event twice');
    assert.deepEqual(await getEntitlements(uid), { sim: true, suite: false });
  });
});

test('revokeApplePass expires the pass and locks the gate immediately', async () => {
  await withTempUser(async (uid) => {
    await grantApplePass(rcEvent({ userId: uid, appUserId: String(uid) }));
    const rev = rcEvent({ userId: uid, appUserId: String(uid), type: 'CANCELLATION' });
    assert.equal(await revokeApplePass(rev), uid);
    const [row] = await sql`SELECT status, expires_at FROM memberships WHERE user_id = ${uid}`;
    assert.equal(row.status, 'canceled');
    assert.ok(new Date(row.expires_at).getTime() <= Date.now(), 'expiry is not in the past');
    assert.deepEqual(await getEntitlements(uid), { sim: false, suite: false });
  });
});

test('a REPLAYED purchase after a refund does NOT re-grant the Pass', async () => {
  // THE REASON THE LEDGER EXISTS. The membership upsert is already idempotent by
  // PK, so a lone redelivery is harmless; what is not harmless is a redelivery
  // arriving AFTER a revocation and quietly restoring access to someone who was
  // refunded. Without the event-id ledger this test fails.
  await withTempUser(async (uid) => {
    const buy = rcEvent({ userId: uid, appUserId: String(uid) });
    await grantApplePass(buy);
    await revokeApplePass(rcEvent({ userId: uid, appUserId: String(uid), type: 'REFUND' }));
    assert.deepEqual(await getEntitlements(uid), { sim: false, suite: false });

    assert.equal(await grantApplePass(buy), null, 'the replayed purchase re-granted the Pass');
    assert.deepEqual(await getEntitlements(uid), { sim: false, suite: false });
  });
});

test('a genuinely new purchase after a refund DOES grant again', async () => {
  // The dedupe must be per EVENT, not per user - someone who refunds and buys
  // again has to get what they paid for.
  await withTempUser(async (uid) => {
    await grantApplePass(rcEvent({ userId: uid, appUserId: String(uid) }));
    await revokeApplePass(rcEvent({ userId: uid, appUserId: String(uid), type: 'REFUND' }));
    assert.equal(await grantApplePass(rcEvent({ userId: uid, appUserId: String(uid) })), uid);
    assert.deepEqual(await getEntitlements(uid), { sim: true, suite: false });
  });
});

test('an Apple refund NEVER touches a Stripe membership', async () => {
  // The source guard in the WHERE clause. Without it, a user who refunded on
  // Apple and later subscribed on the web loses the subscription they pay for.
  await withTempUser(async (uid) => {
    await upsertPassForUser(uid, { stripeCustomerId: 'cus_x', expiresAt: DRAFT_PASS_EXPIRES_AT });
    const [before] = await sql`SELECT source, status FROM memberships WHERE user_id = ${uid}`;
    assert.equal(before.source, 'stripe', 'the Stripe writer should leave source at its default');

    assert.equal(await revokeApplePass(rcEvent({ userId: uid, appUserId: String(uid), type: 'REFUND' })), null);
    const [after] = await sql`SELECT source, status FROM memberships WHERE user_id = ${uid}`;
    assert.equal(after.status, 'active', 'an Apple refund revoked a Stripe membership');
    assert.deepEqual(await getEntitlements(uid), { sim: true, suite: false });
  });
});

test('ignored events are ledgered without touching memberships', async () => {
  await withTempUser(async (uid) => {
    const ev = rcEvent({ userId: uid, appUserId: String(uid), type: 'TRANSFER' });
    await recordIgnoredRevenueCatEvent(ev);
    await recordIgnoredRevenueCatEvent(ev); // idempotent
    const led = await sql`SELECT count(*)::int c FROM revenuecat_events WHERE event_id = ${ev.id}`;
    assert.equal(led[0].c, 1);
    const m = await sql`SELECT count(*)::int c FROM memberships WHERE user_id = ${uid}`;
    assert.equal(m[0].c, 0, 'an ignored event wrote a membership row');
  });
});

test('the source column only accepts stripe | apple', async () => {
  await withTempUser(async (uid) => {
    await grantApplePass(rcEvent({ userId: uid, appUserId: String(uid) }));
    await assert.rejects(
      () => sql`UPDATE memberships SET source = 'paypal' WHERE user_id = ${uid}`,
      /memberships_source_chk|violates check constraint/,
    );
  });
});
