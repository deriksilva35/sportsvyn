-- Migration 001: email_signups
-- Captures email subscriptions from the public site.
-- One row per email address. Tier and confirmation state tracked over time.

CREATE TABLE email_signups (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL UNIQUE,
  tier                text NOT NULL DEFAULT 'free',
  sports_interests    text[],
  created_at          timestamptz NOT NULL DEFAULT now(),
  source              text NOT NULL DEFAULT 'homepage',
  utm_source          text,
  utm_medium          text,
  utm_campaign        text,
  confirmed_at        timestamptz,
  confirmation_token  text,
  unsubscribed_at     timestamptz,
  notes               text
);

-- Indexes
CREATE INDEX idx_email_signups_created_at ON email_signups(created_at DESC);
CREATE INDEX idx_email_signups_tier ON email_signups(tier) WHERE tier != 'free';
CREATE INDEX idx_email_signups_confirmation_token ON email_signups(confirmation_token) WHERE confirmation_token IS NOT NULL;

-- Comments for future-me
COMMENT ON TABLE email_signups IS 'Email subscriptions from sportsvyn.com. One row per email.';
COMMENT ON COLUMN email_signups.tier IS 'One of: free, founding, paid, comp, churned. Default free.';
COMMENT ON COLUMN email_signups.sports_interests IS 'Array of sport keys for future segmentation. NULL = no preference captured.';
COMMENT ON COLUMN email_signups.confirmation_token IS 'Single-use token sent in confirmation email. Set NULL after use.';
COMMENT ON COLUMN email_signups.notes IS 'Admin-added free-text context about this signup.';
