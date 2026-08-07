-- 058_users_signup_provenance.sql
--
-- Adds the two things the launch funnel could not answer:
--   users.created_at          when the account was made
--   users.first_seen_context  how it arrived (auth route + shell-or-web)
--
-- WHY THIS EXISTS. The Aug 6 launch funnel had to infer every signup time from
-- `sessions.expires - 30d`, because nothing in this schema records when a user
-- row was created. That inference is good enough to sort accounts and useless
-- for anything else: it moves every time a session is refreshed, and it silently
-- disappears when a session expires. Six organic signups arrived on launch day
-- and four never started a draft; nothing recorded what any of them saw.
--
-- ============================ NULLs STAY HONEST =============================
-- The 13 rows that predate this column are left NULL. There is no honest value
-- to backfill - `sessions.expires - 30d` is an estimate, and writing an estimate
-- into a column named created_at turns a guess into a fact that later readers
-- have no way to question. NULL says "we did not record this", which is true.
--
-- THE COLUMN IS THEREFORE ADDED BARE AND DEFAULTED IN A SECOND STATEMENT.
-- This is not stylistic. Since PostgreSQL 11, ADD COLUMN with a non-volatile
-- default applies that default to EXISTING rows too (via attmissingval), so
--
--     ALTER TABLE users ADD COLUMN created_at timestamptz DEFAULT now();
--
-- would stamp all 13 pre-existing users with the migration's own timestamp -
-- the exact dishonest backfill this migration is written to avoid. Verified on
-- DEV before writing this: the one-statement form set both existing probe rows
-- to the migration time; the two-statement form left them NULL and still
-- defaulted new inserts.
--
-- first_seen_context carries NO default. It is written once at signup by the
-- auth layer (a separate change); a default would invent provenance for rows
-- whose provenance is exactly what we do not know.
--
-- Reversible: both columns drop cleanly, nothing reads them yet.
--   ALTER TABLE users DROP COLUMN first_seen_context;
--   ALTER TABLE users DROP COLUMN created_at;

ALTER TABLE users ADD COLUMN created_at timestamptz;
ALTER TABLE users ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE users ADD COLUMN first_seen_context text;

COMMENT ON COLUMN users.created_at IS
  'Account creation. NULL for rows predating migration 058 - there is no honest '
  'value to backfill, and an estimate written here would read as a fact. New '
  'rows take now() from the column default.';

COMMENT ON COLUMN users.first_seen_context IS
  'How this account first arrived: auth route plus shell-or-web, written once at '
  'signup and never updated. NULL for rows predating migration 058, and for any '
  'signup path that has not been taught to set it.';
