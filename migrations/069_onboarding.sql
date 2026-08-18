-- 069_onboarding.sql — a contact address that is not an auth identity.
--
-- ============================================================================
-- WHY THIS IS A SEPARATE COLUMN AND NOT users.email
-- ============================================================================
-- users.email IS AN AUTH KEY. @auth/pg-adapter resolves sign-in with
-- `SELECT * FROM users WHERE email = $1`, and lib/auth/emailOtp.js does the
-- same lookup by hand. Nineteen of sixty-one accounts have no `accounts` row at
-- all - they are magic-link users, and users.email is their ONLY identity.
--
-- There is also no unique index on users.email, and adding one now would fail
-- on any existing duplicate and is not this migration's business. So writing a
-- user-supplied contact address into that column could repoint an auth key and
-- could collide two accounts onto one address. That is an account-takeover
-- shape, not an untidiness.
--
-- Hence: onboarding writes ONLY contact_email. Auth never reads it.
--
-- NO UNIQUE INDEX ON contact_email, deliberately. Two people in a household
-- sharing an address is legitimate, and a signup that fails because a partner
-- already used the same inbox is a worse outcome than a duplicate row.

ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_email    text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_email_at timestamptz;

-- Set when the onboarding sheet is COMPLETED (a handle was claimed through it).
--
-- NOT the trigger. The sheet shows on `handle IS NULL`, which is the one thing
-- that must be true before somebody appears on a leaderboard - so a user who
-- claimed a handle on the Daily long before this shipped is never shown the
-- sheet, and this column stays null for them. It exists to answer "did this
-- person come through the flow", which the trigger cannot tell you afterwards.
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

-- The broadcast's recipient query reads COALESCE(contact_email, email), so it
-- filters on both. Partial: only rows that actually supplied one.
CREATE INDEX IF NOT EXISTS idx_users_contact_email
  ON users (contact_email) WHERE contact_email IS NOT NULL;
