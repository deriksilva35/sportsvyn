-- ============================================================================
-- Migration 051 — email_otp (6-digit code redemption for magic-link sign-in)
-- ============================================================================
-- A 6-digit code, tied to the SAME Auth.js verification token as the magic link,
-- so it is an additional redemption path with the same 10-minute expiry and
-- single-use semantics. Written by auth.js sendVerificationRequest (independent
-- of the adapter's verification_token insert — no race), verified server-side by
-- lib/auth/emailOtp.js.
--
--   · token_hash = sha256(rawToken + AUTH_SECRET) — EQUALS verification_token.token
--     for the same send, so redemption can check the link is still unspent and
--     consume BOTH on success (whichever path is used first wins).
--   · code_hash  = sha256(code + AUTH_SECRET) — the code is never stored plaintext.
--   · attempts   — 5 wrong tries invalidates the token (delete row + the linked
--     verification_token). Single-use: the row is deleted on success.
--
-- Additive; reversible by DROP TABLE. Depends: 026 (verification_token schema).
-- ============================================================================

CREATE TABLE email_otp (
  identifier text        NOT NULL,
  token_hash text        NOT NULL,
  code_hash  text        NOT NULL,
  expires    timestamptz NOT NULL,
  attempts   integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (identifier, token_hash)
);

CREATE INDEX idx_email_otp_lookup ON email_otp (identifier, expires DESC);

COMMENT ON TABLE email_otp IS 'A 6-digit code bound to an Auth.js verification token (token_hash = verification_token.token). Additional single-use redemption path for magic-link sign-in; same 10-minute expiry; 5-attempt cap.';
