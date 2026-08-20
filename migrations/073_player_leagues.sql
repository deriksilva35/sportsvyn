-- 073: player leagues - the social spine. Create, join by code, member-scoped
-- boards.
--
-- ============================================================================
-- THE NAMING LANDMINE, stated where every future reader will trip on it
-- ============================================================================
-- The table name `leagues` is TAKEN: it is the SPORTS-league table (NFL, CFB,
-- soccer competition rows - l.sport, season_year, external_ids). These tables
-- are PLAYER leagues - groups of friends. player_leagues / league_members,
-- never bare `leagues`, and any query joining "leagues" in a fantasy context
-- is a bug until proven otherwise.
--
-- OWNER DELETION KEEPS THE LEAGUE (SET NULL): a league is its members', not
-- its creator's - the deletion flow already proved account removal cascades
-- cleanly, and orphaning eleven friends' season because the twelfth left
-- would be the wrong reading of ownership. MEMBER deletion cascades: a
-- membership is personal.
--
-- join_code is UNIQUE and the generator retries on collision (lib/leagues).
-- No dead-code reuse: a deleted league frees its code, which is fine - codes
-- gate JOINING, not identity; league_id is identity.

CREATE TABLE IF NOT EXISTS player_leagues (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  owner_id    integer REFERENCES users(id) ON DELETE SET NULL,
  join_code   text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS league_members (
  league_id   integer NOT NULL REFERENCES player_leagues(id) ON DELETE CASCADE,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id)
);

-- The scoping query's index: "which leagues am I in" and "who is in this
-- league" are both PK-prefix scans; this covers the reverse direction.
CREATE INDEX IF NOT EXISTS league_members_user_idx ON league_members (user_id);
