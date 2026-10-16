-- 144_league_home.sql - the league home (Leagues Phase 1, slices 1-2, thu-4).
--
-- 1. ROLES AND NOTIFICATION PREFS ON THE MEMBERSHIP. The owner stays
--    player_leagues.owner_id (one owner, never a role value here, so there is
--    no second place an owner can be recorded); a member is 'member' or
--    'co_admin'. The three toggles are STORED now and read by the senders when
--    they are built: chat and daily results default on, "someone joins" off.
--
-- 2. league_events - the "Latest in the league" strip. One row per thing that
--    happened: join, period_winner, took_first, chopped. WRITTEN ONCE: the
--    UNIQUE key (league, kind, user, period_key) plus ON CONFLICT DO NOTHING in
--    every writer, so the hourly tick and a retried join can never double a
--    line. A join's period_key is '' (one join per member per league; a member
--    removed and let back in does not get a second line). `at` is when it
--    HAPPENED (a bucket's end, a join's joined_at), which is what the strip
--    sorts by; created_at is when we wrote it.
--
-- 3. league_removals - a member the owner (or a co-admin) removed cannot walk
--    back in with the same code. The join path refuses them; the owner can let
--    them back by deleting the row (not built yet: nobody has asked).
--
-- Member deletion cascades everywhere, like league_members (migration 073).
-- UNDO:
--   DROP TABLE league_removals; DROP TABLE league_events;
--   ALTER TABLE league_members DROP COLUMN role, DROP COLUMN notify_chat,
--     DROP COLUMN notify_results, DROP COLUMN notify_joins;

ALTER TABLE league_members
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS notify_chat boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_results boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_joins boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE league_members ADD CONSTRAINT league_members_role_check CHECK (role IN ('member', 'co_admin'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS league_events (
  id          bigserial PRIMARY KEY,
  league_id   integer NOT NULL REFERENCES player_leagues(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('join', 'period_winner', 'took_first', 'chopped')),
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_key  text NOT NULL DEFAULT '',
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  at          timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, kind, user_id, period_key)
);
CREATE INDEX IF NOT EXISTS league_events_latest_idx ON league_events (league_id, at DESC);

CREATE TABLE IF NOT EXISTS league_removals (
  league_id   integer NOT NULL REFERENCES player_leagues(id) ON DELETE CASCADE,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  removed_by  integer REFERENCES users(id) ON DELETE SET NULL,
  removed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id)
);

-- Every membership that already exists is a join that already happened.
INSERT INTO league_events (league_id, kind, user_id, period_key, at)
SELECT league_id, 'join', user_id, '', joined_at FROM league_members
ON CONFLICT DO NOTHING;
-- And every chop already decided (migration 122's one stored decision).
INSERT INTO league_events (league_id, kind, user_id, period_key, payload, at)
SELECT league_id, 'chopped', user_id, period_key,
       jsonb_build_object('periodTotal', period_total, 'seasonTotal', season_total), decided_at
  FROM player_league_eliminations
ON CONFLICT DO NOTHING;
