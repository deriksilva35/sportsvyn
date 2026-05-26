-- Migration 002: add confirmation_sent_at to email_signups
-- Tracks when the most-recent confirmation email was sent, so tokens
-- can expire 7 days after that timestamp. Updated on resend.
--
-- Also NULLs any pre-Session-3c confirmation_tokens that were inserted
-- by Session 3a's signup endpoint but never actually emailed (the
-- Resend send didn't exist yet). Those tokens aren't "in the wild" --
-- no human ever received them -- so leaving them confirmable would
-- create a phantom-confirmation path with no human gesture behind it.
-- Affected users get the standard unconfirmed signup path if they
-- re-submit at sportsvyn.com.

ALTER TABLE email_signups
  ADD COLUMN confirmation_sent_at timestamptz;

UPDATE email_signups
  SET confirmation_token = NULL
  WHERE confirmation_token IS NOT NULL
    AND confirmed_at IS NULL;

COMMENT ON COLUMN email_signups.confirmation_sent_at IS 'Timestamp the confirmation email was last sent. Used to expire confirmation tokens after 7 days. Updated on resend.';
