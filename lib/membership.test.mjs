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
