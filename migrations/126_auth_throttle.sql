-- 126_auth_throttle.sql - sign-in email caps and the per-email wrong-code window
-- (RULING sun-12 item 2, SECURITY).
--
-- WHY A NEW TABLE. email_otp (051) cannot be counted: its rows are deleted when
-- a code is redeemed, when its 5 tries run out, and by attachCode's
-- housekeeping of expired rows. A count over a table that deletes its own
-- history is a count that an attacker resets by finishing a code. So every
-- send and every wrong code leaves one row here, and the caps in
-- lib/auth/rateLimit.js (AUTH_LIMITS) are rolling-window counts over it.
--
--   kind = 'send'  one email we sent (or refused to send) carrying a code or a
--                  link: purpose 'signin' (auth.js sendVerificationRequest) or
--                  'signup_confirm' (app/api/email/signup). refused = true is a
--                  request the cap turned away; refused rows are NOT counted
--                  against the cap, so hammering a capped address does not
--                  extend its own lock-out.
--   kind = 'fail'  one wrong 6-digit code for that identifier (lib/auth/emailOtp.js).
--
-- identifier is the normalised (trimmed, lower-cased) email. ip is the
-- caller's address as Vercel reports it, or NULL when there is none.
--
-- Rows older than two days are deleted by the writer (no window is longer than
-- 24h). Additive; reversible by DROP TABLE.

CREATE TABLE IF NOT EXISTS auth_throttle (
  id         bigserial   PRIMARY KEY,
  kind       text        NOT NULL CHECK (kind IN ('send', 'fail')),
  identifier text        NOT NULL,
  ip         text,
  purpose    text,
  refused    boolean     NOT NULL DEFAULT false,
  at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_throttle_identifier ON auth_throttle (identifier, kind, at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_throttle_ip ON auth_throttle (ip, kind, at DESC) WHERE ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_throttle_at ON auth_throttle (at);

COMMENT ON TABLE auth_throttle IS 'Rolling-window ledger for sign-in email caps (kind=send) and the per-email wrong-code lock (kind=fail). Read by lib/auth/rateLimit.js; rows older than 2 days are pruned by the writer.';
