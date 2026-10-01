-- 118: Survivor - one NFL team a week, no reuse, lose and you're out.
--
-- THREE TABLES AND ONE SEED ROW. A pool is the set of rules (national, or one
-- player league's), an entry is a reader in a pool with their lives, a pick is
-- one team in one week. Nothing here re-scores a game: a pick is graded off
-- matches.status / home_score / away_score, the finals every other game reads.
--
-- THE LEAGUE LINK IS ONE COLUMN. survivor_pools.league_id -> player_leagues
-- (073), NULL for the national pool. Leagues V1 attaches a pool to a league by
-- inserting a row with its id; nothing else about a league is needed here. The
-- naming landmine stands: `leagues` is the SPORTS table and is never joined
-- for this (073's header).
--
-- NO REUSE IS AN INDEX, NOT A CHECK IN CODE. UNIQUE (pool_id, user_id, team_id)
-- is the whole policy - two taps racing on a used team produce one row and one
-- refusal, in commit order. A missed week is a pick row with team_id NULL, and
-- NULLs are distinct, so any number of missed weeks never collide.
--
-- RESULTS ARE A WORD, NOT A BOOLEAN:
--   pending  - not graded yet
--   win      - the picked team won
--   loss     - lost, OR TIED (ruled 1 Oct: a tie is a loss)
--   survive  - the game was cancelled or not played inside its NFL week: the
--              entry lives, and the team stays used (ruled 1 Oct)
--   missed   - no pick and none could be assigned; costs a life like a loss
-- LIVES ARE DERIVED: survivor_entries.lives_left / eliminated_week are rewritten
-- from the pick rows by every grading run (lib/survivor/grade.js), so a crash
-- between two statements cannot strand a life.
--
-- ENTRIES CLOSE AT THE START WEEK'S FIRST KICKOFF unless late_entry is true.
-- That is the standard survivor rule; a league pool can open it.

CREATE TABLE IF NOT EXISTS survivor_pools (
  id           serial PRIMARY KEY,
  league_id    integer REFERENCES player_leagues(id) ON DELETE CASCADE,  -- NULL = national
  sport        text    NOT NULL DEFAULT 'nfl',   -- = leagues.slug of the schedule it reads
  season_year  integer NOT NULL,
  start_week   integer NOT NULL CHECK (start_week BETWEEN 1 AND 18),
  lives        integer NOT NULL DEFAULT 1 CHECK (lives IN (1, 2)),
  missed       text    NOT NULL DEFAULT 'auto' CHECK (missed IN ('out', 'auto')),
  late_entry   boolean NOT NULL DEFAULT false,
  name         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One national pool per sport-season; one pool per league per sport-season.
CREATE UNIQUE INDEX IF NOT EXISTS survivor_pools_national_key
  ON survivor_pools (sport, season_year) WHERE league_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS survivor_pools_league_key
  ON survivor_pools (league_id, sport, season_year) WHERE league_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS survivor_entries (
  pool_id          integer NOT NULL REFERENCES survivor_pools(id) ON DELETE CASCADE,
  user_id          integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lives_left       integer NOT NULL CHECK (lives_left >= 0),
  eliminated_week  integer,
  joined_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pool_id, user_id)
);
CREATE INDEX IF NOT EXISTS survivor_entries_user_idx ON survivor_entries (user_id);

CREATE TABLE IF NOT EXISTS survivor_picks (
  pool_id    integer NOT NULL,
  user_id    integer NOT NULL,
  week       integer NOT NULL,
  team_id    integer REFERENCES teams(id) ON DELETE RESTRICT,
  match_id   integer REFERENCES matches(id) ON DELETE RESTRICT,
  auto       boolean NOT NULL DEFAULT false,
  result     text    NOT NULL DEFAULT 'pending'
               CHECK (result IN ('pending', 'win', 'loss', 'survive', 'missed')),
  picked_at  timestamptz NOT NULL DEFAULT now(),
  graded_at  timestamptz,
  PRIMARY KEY (pool_id, user_id, week),
  FOREIGN KEY (pool_id, user_id) REFERENCES survivor_entries(pool_id, user_id) ON DELETE CASCADE,
  -- A team row needs its game and a game row needs its team; a missed week has neither.
  CONSTRAINT survivor_picks_team_shape CHECK ((team_id IS NULL) = (match_id IS NULL)),
  CONSTRAINT survivor_picks_missed_shape CHECK (result <> 'missed' OR team_id IS NULL)
);
-- NO REUSE, decided by the index (see header).
CREATE UNIQUE INDEX IF NOT EXISTS survivor_picks_no_reuse
  ON survivor_picks (pool_id, user_id, team_id) WHERE team_id IS NOT NULL;
-- The grader's scan: every pending pick of a pool.
CREATE INDEX IF NOT EXISTS survivor_picks_pending_idx
  ON survivor_picks (pool_id, week) WHERE result = 'pending';
CREATE INDEX IF NOT EXISTS survivor_picks_match_idx ON survivor_picks (match_id);

-- THE NATIONAL POOL, 2026: starts NFL Week 5, one life, a missed pick is auto-
-- assigned (ruled 1 Oct). Idempotent - a second apply changes nothing.
INSERT INTO survivor_pools (league_id, sport, season_year, start_week, lives, missed, late_entry, name)
VALUES (NULL, 'nfl', 2026, 5, 1, 'auto', false, 'National')
ON CONFLICT (sport, season_year) WHERE league_id IS NULL DO NOTHING;
