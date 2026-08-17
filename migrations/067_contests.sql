-- 067_contests.sql — the contest spine, and the Weekly as its first tenant.
--
-- WHY A SPINE AT ALL. Three games now want the same three things: a round that
-- opens and closes, one entry per user per round, and a standing computed from
-- settled rounds only. The Daily proved the shape; doing it a second time in a
-- weekly_* set of tables and a third time in a pickem_* set would mean three
-- copies of the leak law, and three chances to get it wrong once.
--
-- THE DAILY IS NOT MIGRATED HERE, deliberately. puzzle_days/puzzle_entries are
-- live, played and correct. Moving a running game onto a pattern to prove the
-- pattern is the wrong order; the Weekly proves it first, and the Daily moves
-- later or never. Two shapes for a while is cheaper than one broken migration.
--
-- WHAT A ROUND IS KEYED BY DIFFERS PER GAME, so the spine carries all of it and
-- a partial unique index enforces the right one:
--   daily   -> (sport, puzzle_date)
--   weekly  -> (sport, season_year, week)
--   pickem  -> (sport, season_year, week)
-- A CHECK keeps a weekly row from existing without a week, which is the shape
-- error that would otherwise surface as a duplicate board three weeks later.

CREATE TABLE IF NOT EXISTS contests (
  id            serial PRIMARY KEY,
  game_type     text NOT NULL,                    -- 'weekly' | 'pickem' | 'daily'
  sport         text NOT NULL DEFAULT 'nfl',
  season_year   integer,
  week          integer,
  puzzle_date   date,
  -- The pool SNAPSHOT, frozen at creation. See lib/weekly/pool.js: the pool
  -- must not shift under a lineup somebody already saved.
  board         jsonb,
  opens_at      timestamptz NOT NULL,
  -- LOCKS_AT IS SNAPSHOTTED AND DOES NOT CHASE. If Thursday's game moves after
  -- the board opens, the deadline players planned around is the deadline.
  locks_at      timestamptz NOT NULL,
  settles_at    timestamptz,
  settled       boolean NOT NULL DEFAULT false,
  perfect       jsonb,
  meta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  settled_at    timestamptz,
  CONSTRAINT contests_week_shape CHECK (
    (game_type = 'daily'  AND puzzle_date IS NOT NULL)
    OR (game_type <> 'daily' AND season_year IS NOT NULL AND week IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contests_week
  ON contests (game_type, sport, season_year, week) WHERE puzzle_date IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contests_date
  ON contests (game_type, sport, puzzle_date) WHERE puzzle_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contests_settle
  ON contests (settled, settles_at) WHERE NOT settled;

-- ONE ENTRY PER USER PER CONTEST, and it is EDITABLE until the round locks.
--
-- NO HISTORY. An update overwrites the lineup; we do not keep what it was.
-- That is a product ruling, not an oversight: a weekly lineup is a draft until
-- the deadline, and storing every intermediate state would be a leak surface
-- (who flip-flopped on whom) for no reader benefit.
--
-- locked_at IS SET AT LOCK, NOT AT SAVE. A saved lineup is not a locked one -
-- the distinction is what makes "editable until Thursday" true, and what lets
-- the settle job tell an abandoned draft from a submitted lineup.
CREATE TABLE IF NOT EXISTS contest_entries (
  id          serial PRIMARY KEY,
  contest_id  integer NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lineup      jsonb NOT NULL DEFAULT '{}'::jsonb,
  score       numeric,
  base_score  numeric,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  locked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contest_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_entries_contest ON contest_entries (contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_entries_score
  ON contest_entries (contest_id, score DESC) WHERE score IS NOT NULL;
