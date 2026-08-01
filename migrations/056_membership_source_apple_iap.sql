-- ============================================================================
-- Migration 056 — Apple IAP: membership provenance + RevenueCat event ledger
-- ============================================================================
-- Apple rejected 1.0(2) TWICE under Guideline 3.1.1. The first rejection was
-- "you can buy outside the app"; suppressing every purchase path (see 76e18e0)
-- did not clear it, because the second rejection is the OTHER half of 3.1.1:
--
--   "The app accesses digital content purchased outside the app, such as
--    membership, but that content isn't available to purchase using In-App
--    Purchase."
--
-- Hiding the commerce was never going to be enough - the app READS membership-
-- gated content, so the Pass has to be buyable IN the app via IAP. This migration
-- is the server half of that: it lets a membership row record WHERE it came from,
-- and gives the RevenueCat webhook somewhere to dedupe events.
--
--   source  'stripe' | 'apple'   NOT NULL DEFAULT 'stripe'
--
-- Existing rows backfill to 'stripe' via the DEFAULT (Postgres 11+ fills this in
-- without a table rewrite), which is correct: every row that exists today was
-- written by the Stripe webhook.
--
-- ENTITLEMENT IS DELIBERATELY SOURCE-BLIND. lib/membership.js entitlementsFromRow()
-- does not read this column and must not start: an Apple Pass and a Stripe Pass
-- grant exactly the same thing (sim, until expires_at). `source` exists for
-- provenance - refund routing, support, and knowing which store to point someone
-- at - not for gating. lib/membership.test.mjs pins that parity.
--
-- Additive + reversible:
--   ALTER TABLE memberships DROP CONSTRAINT memberships_source_chk;
--   ALTER TABLE memberships DROP COLUMN source;
--   DROP TABLE revenuecat_events;
-- Depends: 050 (memberships), 053 (kind/tier/expires_at), 026 (users).
-- ============================================================================

ALTER TABLE memberships
  ADD COLUMN source text NOT NULL DEFAULT 'stripe';

ALTER TABLE memberships
  ADD CONSTRAINT memberships_source_chk CHECK (source IN ('stripe', 'apple'));

COMMENT ON COLUMN memberships.source IS
  'stripe | apple - which store sold this membership. Provenance only; entitlement is source-blind.';

-- ----------------------------------------------------------------------------
-- RevenueCat event ledger — idempotency, not analytics.
-- ----------------------------------------------------------------------------
-- The membership upsert is already idempotent by PK (user_id), so a plain
-- redelivery of one event is harmless. This table exists for the case that is
-- NOT harmless: events arriving out of order or replayed ACROSS types. Without a
-- ledger, a redelivered INITIAL_PURCHASE landing after a CANCELLATION silently
-- re-grants the Pass to someone who was refunded. Recording every event id and
-- refusing to process one twice makes the sequence, not just each write, safe.
--
-- event_id is RevenueCat's event UUID, unique per event (a redelivery reuses it,
-- which is exactly what makes it a dedupe key).
--
-- ON DELETE CASCADE: users("id") deletion (guideline 5.1.1(v), lib/account.js)
-- must not be blocked by this table, and the ledger holds a user reference, so it
-- goes when they go. The FK map comment in lib/account.js records this.
CREATE TABLE revenuecat_events (
  event_id    text        PRIMARY KEY,
  type        text        NOT NULL,
  app_user_id text,
  user_id     integer     REFERENCES users("id") ON DELETE CASCADE,
  product_id  text,
  environment text,                    -- PRODUCTION | SANDBOX (App Review buys in SANDBOX)
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_revenuecat_events_user ON revenuecat_events (user_id);

COMMENT ON TABLE revenuecat_events IS
  'RevenueCat webhook event ledger, keyed by their event id. Exists so a replayed or out-of-order event cannot re-grant a revoked Pass.';
