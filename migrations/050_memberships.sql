-- ============================================================================
-- Migration 050 — memberships (Stripe-backed membership state)
-- ============================================================================
-- The store behind the isMember() seam (lib/fantasy/drafts.js). One row per user
-- (a user holds at most one subscription), keyed to the adapter users("id").
--
-- Written ONLY by the Stripe webhook (/api/stripe/webhook) on
-- checkout.session.completed + customer.subscription.updated/deleted. The user is
-- resolved from the Checkout Session's client_reference_id (= users.id). Reads:
--   isMember(userId) = EXISTS row WHERE status IN ('active','trialing')
--                      AND (current_period_end IS NULL OR current_period_end > now())
--
-- founding vs monthly/annual is derivable from price_id, so no tier column.
-- Additive + reversible: DROP TABLE memberships. Depends: 026 (users).
-- ============================================================================

CREATE TABLE memberships (
  user_id                integer     PRIMARY KEY REFERENCES users("id") ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text        UNIQUE,
  status                 text,        -- active | trialing | past_due | canceled | incomplete | ...
  price_id               text,        -- captures monthly / annual / founding
  current_period_end     timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memberships_customer     ON memberships (stripe_customer_id);
CREATE INDEX idx_memberships_subscription ON memberships (stripe_subscription_id);

COMMENT ON TABLE memberships IS 'Stripe subscription state per user; the store behind isMember(). Written only by the Stripe webhook, keyed via checkout client_reference_id = users.id.';
