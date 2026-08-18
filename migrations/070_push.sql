-- 070: push notifications - device tokens + the pre-warm choice.
--
-- DEVICE_TOKENS IS THE SKRY'S SHAPE, ported deliberately: nullable user_id
-- (a token can outlive the session that registered it, and a signed-out
-- device is still a device), revoked_at as a timestamp rather than a boolean
-- (WHEN a token died is the debugging fact; a boolean forgets it), and
-- REVIVE-IN-PLACE - re-registering a revoked token clears revoked_at rather
-- than inserting a duplicate, because APNs reissues the same token string for
-- the same app install and a UNIQUE violation on re-enable was the Skry's
-- first push bug.
--
-- THE TOKEN IS THE KEY, not the user: one person signs in on two devices and
-- gets two rows; two people share an iPad and the row follows whoever
-- registered last. Both are correct - delivery is to DEVICES.

CREATE TABLE IF NOT EXISTS device_tokens (
  token       text PRIMARY KEY,
  user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  platform    text NOT NULL DEFAULT 'ios',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

-- The fan-out query: every live token. Partial, because revoked rows are kept
-- for the record but never read on the hot path.
CREATE INDEX IF NOT EXISTS device_tokens_live_idx
  ON device_tokens (token) WHERE revoked_at IS NULL;

-- THE PRE-WARM CHOICE, server-side like the other onboarding skips (069's
-- contact_email_at / onboarded_at). push_prompted_at records that OUR screen
-- was shown - the OS prompt is a one-shot Apple owns, so the thing to never
-- waste is showing it before our screen has said yes. push_choice records
-- what they said ('enabled' | 'not-now'), so a NOT NOW is never re-asked by
-- the one-time nudge, only reachable through the profile row.
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_prompted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_choice text;
