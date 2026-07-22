/**
 * lib/membership.js — the memberships store behind the isMember() seam.
 *
 * Reads: membershipIsActive() (the entitlement test) + getMembership() (account
 * status line). Writes: only the Stripe webhook calls the upserts here.
 */

import { sql } from './db.js';

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

// Entitlement test used by isMember(): reads the row, applies the pure predicate.
export async function membershipIsActive(userId) {
  if (userId == null) return false;
  return membershipRowIsActive(await getMembership(userId));
}

// Full row for the account status line (MEMBER since / renews / FREE).
export async function getMembership(userId) {
  if (userId == null) return null;
  const r = await sql`SELECT * FROM memberships WHERE user_id = ${userId} LIMIT 1`;
  return r[0] ?? null;
}

// Webhook writer: checkout.session.completed resolves the user (client_reference_id)
// and upserts the whole row. One row per user (PK), so this is idempotent.
export async function upsertMembershipForUser(userId, f) {
  await sql`
    INSERT INTO memberships
      (user_id, stripe_customer_id, stripe_subscription_id, status, price_id, current_period_end, updated_at)
    VALUES
      (${userId}, ${f.stripeCustomerId}, ${f.stripeSubscriptionId}, ${f.status}, ${f.priceId}, ${f.currentPeriodEnd}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      stripe_customer_id     = EXCLUDED.stripe_customer_id,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      status                 = EXCLUDED.status,
      price_id               = EXCLUDED.price_id,
      current_period_end     = EXCLUDED.current_period_end,
      updated_at             = now()`;
}

// Webhook writer: customer.subscription.updated/deleted carries no user ref, so
// we match the existing row by subscription id. No-op (returns null) if the row
// isn't present yet — the checkout.session.completed event will create it.
export async function updateMembershipBySubscription(f) {
  const r = await sql`
    UPDATE memberships SET
      status             = ${f.status},
      price_id           = ${f.priceId},
      current_period_end = ${f.currentPeriodEnd},
      stripe_customer_id = COALESCE(stripe_customer_id, ${f.stripeCustomerId}),
      updated_at         = now()
    WHERE stripe_subscription_id = ${f.stripeSubscriptionId}
    RETURNING user_id`;
  return r[0]?.user_id ?? null;
}
