-- 098_users_last_seen_at.sql
-- WHEN DID THIS ACCOUNT LAST DO ANYTHING SIGNED IN. The Wednesday read after
-- the launch send had no login timestamp at all: "signed in" had to be
-- inferred from session expiry. Written by the session lookup every
-- authenticated request goes through (auth.js getSessionAndUser), throttled to
-- one UPDATE per user per hour by the statement's own WHERE clause - a second
-- request inside the hour matches zero rows and writes nothing.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_users_last_seen_at ON users (last_seen_at) WHERE last_seen_at IS NOT NULL;
COMMENT ON COLUMN users.last_seen_at IS
  'Last authenticated request, to the hour. Written by the session lookup, at '
  'most once per hour per user. NULL for accounts never seen since 098 landed.';
