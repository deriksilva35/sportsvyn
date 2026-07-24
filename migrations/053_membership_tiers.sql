-- ============================================================================
-- Migration 053 — membership tiers + one-time Draft Pass
-- ============================================================================
-- The pricing restructure replaces the single isMember() boolean with two
-- entitlement levels (sim vs suite) and adds a one-time PASS alongside the
-- subscription. Additive + reversible.
--
--   kind       'subscription' | 'pass'   (NULL on legacy rows = subscription)
--   tier       'pass' | 'suite' | 'founding' (NULL legacy = sim-only sub)
--   expires_at set for passes (governs the pass); NULL for subs (status governs)
--
-- Entitlement read (lib/membership.js getEntitlements):
--   sim   = active sub OR unexpired pass
--   suite = active sub with tier IN ('suite','founding')
--
-- Written only by the Stripe webhook. Reversible:
--   ALTER TABLE memberships DROP COLUMN kind, DROP COLUMN tier, DROP COLUMN expires_at;
-- Depends: 050 (memberships).
-- ============================================================================

ALTER TABLE memberships
  ADD COLUMN kind       text,
  ADD COLUMN tier       text,
  ADD COLUMN expires_at timestamptz;

COMMENT ON COLUMN memberships.kind       IS 'subscription | pass (NULL legacy = subscription)';
COMMENT ON COLUMN memberships.tier       IS 'pass | suite | founding (NULL legacy = sim-only sub)';
COMMENT ON COLUMN memberships.expires_at IS 'Pass expiry (governs a pass row); NULL for subscriptions (status governs).';
