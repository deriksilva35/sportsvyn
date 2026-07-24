/**
 * lib/membership.js — the memberships store behind the isMember() seam.
 *
 * Reads: membershipIsActive() (the entitlement test) + getMembership() (account
 * status line). Writes: only the Stripe webhook calls the upserts here.
 */

import { sql } from './db.js';

// One-time Draft Pass entitlement window: SIM features through 2027-02-15 23:59
// America/New_York (EST, UTC-5 in February) = 2027-02-16T04:59:00Z. Fixed expiry,
// stamped on the pass row by the webhook payment branch.
export const DRAFT_PASS_EXPIRES_AT = '2027-02-16T04:59:00.000Z';

// A subscription price's lookup_key -> entitlement tier. suite/founding grant
// everything; legacy monthly/annual (being retired) map to null = sim-only sub.
export function tierFromLookupKey(lookupKey) {
  if (lookupKey === 'sportsvyn_founding') return 'founding';
  if (lookupKey === 'sportsvyn_suite') return 'suite';
  return null;
}

// Pure entitlement predicate (unit-tested): an active/trialing subscription whose
// period has not ended. NULL current_period_end is treated as active — a just-
// created subscription before the period lands. Kept pure + separate from the DB
// read so the date logic is testable without a database.
export function membershipRowIsActive(row, now = new Date()) {
  if (!row) return false;
  if (row.status !== 'active' && row.status !== 'trialing') return false;
  if (row.current_period_end == null) return true;
  return new Date(row.current_period_end).getTime() > now.getTime();
}

// Pure two-level entitlement resolver (unit-tested):
//   sim   = active subscription OR unexpired pass
//   suite = active subscription with tier IN ('suite','founding')
// A pass (kind='pass') is governed by expires_at, never status/period. A legacy
// row (kind NULL) is treated as a subscription.
export function entitlementsFromRow(row, now = new Date()) {
  if (!row) return { sim: false, suite: false };
  if (row.kind === 'pass') {
    const active = row.expires_at != null && new Date(row.expires_at).getTime() > now.getTime();
    return { sim: active, suite: false };
  }
  const active = membershipRowIsActive(row, now);
  return { sim: active, suite: active && (row.tier === 'suite' || row.tier === 'founding') };
}

// Entitlement read: { sim, suite }. The single source the gates flip off.
export async function getEntitlements(userId) {
  if (userId == null) return { sim: false, suite: false };
  return entitlementsFromRow(await getMembership(userId));
}

// Sim-level entitlement (the isMember() alias): active sub OR unexpired pass.
export async function membershipIsActive(userId) {
  if (userId == null) return false;
  return (await getEntitlements(userId)).sim;
}

// Full row for the account status line (MEMBER since / renews / FREE).
export async function getMembership(userId) {
  if (userId == null) return null;
  const r = await sql`SELECT * FROM memberships WHERE user_id = ${userId} LIMIT 1`;
  return r[0] ?? null;
}

// Webhook writer: checkout.session.completed (subscription) resolves the user
// (client_reference_id) and upserts the whole row. One row per user (PK), so this
// is idempotent. kind='subscription'; tier derived from the price's lookup_key.
export async function upsertMembershipForUser(userId, f) {
  const tier = tierFromLookupKey(f.lookupKey);
  await sql`
    INSERT INTO memberships
      (user_id, stripe_customer_id, stripe_subscription_id, status, price_id,
       current_period_end, kind, tier, expires_at, updated_at)
    VALUES
      (${userId}, ${f.stripeCustomerId}, ${f.stripeSubscriptionId}, ${f.status}, ${f.priceId},
       ${f.currentPeriodEnd}, 'subscription', ${tier}, NULL, now())
    ON CONFLICT (user_id) DO UPDATE SET
      stripe_customer_id     = EXCLUDED.stripe_customer_id,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      status                 = EXCLUDED.status,
      price_id               = EXCLUDED.price_id,
      current_period_end     = EXCLUDED.current_period_end,
      kind                   = 'subscription',
      tier                   = EXCLUDED.tier,
      expires_at             = NULL,
      updated_at             = now()`;
}

// Webhook writer: checkout.session.completed with mode=payment (the one-time Draft
// Pass). Writes a pass row governed by expires_at (SIM until the fixed expiry).
// Idempotent (PK user_id; a redelivery restamps the same expiry).
export async function upsertPassForUser(userId, f) {
  await sql`
    INSERT INTO memberships
      (user_id, stripe_customer_id, stripe_subscription_id, status, price_id,
       current_period_end, kind, tier, expires_at, updated_at)
    VALUES
      (${userId}, ${f.stripeCustomerId}, NULL, 'active', ${f.priceId ?? null},
       NULL, 'pass', 'pass', ${f.expiresAt}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      stripe_customer_id     = EXCLUDED.stripe_customer_id,
      stripe_subscription_id = NULL,
      status                 = 'active',
      price_id               = EXCLUDED.price_id,
      current_period_end     = NULL,
      kind                   = 'pass',
      tier                   = 'pass',
      expires_at             = EXCLUDED.expires_at,
      updated_at             = now()`;
}

// Webhook writer: customer.subscription.updated/deleted carries no user ref, so
// we match the existing row by subscription id. No-op (returns null) if the row
// isn't present yet — the checkout.session.completed event will create it.
export async function updateMembershipBySubscription(f) {
  const tier = tierFromLookupKey(f.lookupKey);
  const r = await sql`
    UPDATE memberships SET
      status             = ${f.status},
      price_id           = ${f.priceId},
      current_period_end = ${f.currentPeriodEnd},
      kind               = 'subscription',
      tier               = ${tier},
      stripe_customer_id = COALESCE(stripe_customer_id, ${f.stripeCustomerId}),
      updated_at         = now()
    WHERE stripe_subscription_id = ${f.stripeSubscriptionId}
    RETURNING user_id`;
  return r[0]?.user_id ?? null;
}
