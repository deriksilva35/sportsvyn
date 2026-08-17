-- 066_handles.sql — player handles for the Daily's leaderboards.
--
-- A COLUMN, NOT A PROFILE TABLE. It is one string. A separate table would mean
-- a join on every leaderboard row to fetch it, and the only genuinely hard part
-- — uniqueness — belongs on the same row as the identity it makes unique. When
-- a profile grows an avatar, a bio and notification preferences, that is when a
-- table earns its join.
--
-- UNIQUENESS IS CASE-INSENSITIVE AND ENFORCED BY THE DATABASE. citext is not
-- installed here (checked: pg_extension holds only plpgsql), so it is a
-- functional unique index on lower(handle) rather than a column type. The
-- application's availability check is advisory and racy by nature; this index
-- is the truth, and the claim path is written to expect a 23505 rather than to
-- trust its own lookup.
--
-- handle IS NULLABLE and that is the normal state. An unclaimed player is not
-- broken; they render as Player <hex> and their scores count exactly the same.
-- A NOT NULL default would have meant inventing a handle for every existing
-- row, which is the opposite of letting someone choose one.

ALTER TABLE users ADD COLUMN IF NOT EXISTS handle text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS handle_changed_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_handle_lower ON users (lower(handle));

-- THE AUDIT AND THE COOLDOWN, in one table.
--
-- released_at IS THE COOLDOWN CLOCK. A handle freed by a rename — voluntary or
-- forced — is blocked from re-claim for 30 days. Without that, the moderation
-- path is self-defeating: force-rename an abusive handle and the same person
-- re-claims it thirty seconds later, or a bystander grabs a name a rival just
-- lost. reason carries why, so a forced rename is distinguishable from a
-- voluntary one when someone appeals.
CREATE TABLE IF NOT EXISTS handle_history (
  id          serial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  handle      text NOT NULL,
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  reason      text
);

CREATE INDEX IF NOT EXISTS idx_handle_history_user ON handle_history (user_id);
-- The cooldown lookup: "is this name blocked right now". Partial, because a
-- row that was never released can never block anything.
CREATE INDEX IF NOT EXISTS idx_handle_history_released
  ON handle_history (lower(handle), released_at) WHERE released_at IS NOT NULL;
