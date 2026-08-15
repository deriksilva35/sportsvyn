-- 064_daily_puzzle.sql — the Daily: one ranked puzzle per ET day over the
-- historical corpus (nfl_player_seasons + nfl_player_game_stats + scoring.js).
--
-- THE PREMISE, STATED ONCE SO NOTHING DOWNSTREAM PRETENDS OTHERWISE: the answers
-- are public record. A board with Peyton Manning and Todd Gurley on it is
-- 2015-2016 to anyone who follows football, and once the season is guessable the
-- box score is one search away. Secrecy is not a defence we have. THE CLOCK IS
-- THE GAME — two minutes, enforced server-side. Everything hidden pre-close is
-- hidden to keep the puzzle honest for people playing it straight, not because
-- hiding it could stop someone determined.
--
-- THE BOARD IS FROZEN, NOT DERIVED. board jsonb holds the finished player list.
-- The obvious alternative — store (season, week, seed) and regenerate per
-- request from a seeded shuffle — is wrong here, because the pool is a function
-- of nfl_player_seasons and nfl_player_game_stats and THOSE TABLES MOVE: 17,839
-- position rows were rewritten on 15 Aug. A re-run that reclassified one player
-- would silently change a board people were mid-way through. Frozen bytes are
-- provably identical for every player of that day; a regenerated pool is only
-- probably identical.

CREATE TABLE IF NOT EXISTS puzzle_days (
  puzzle_date  date PRIMARY KEY,
  season_year  integer NOT NULL,
  week         integer NOT NULL,
  -- hash(puzzle_date + PUZZLE_SEED). The secret is what stops the sequence
  -- being computable a week ahead from the date alone.
  seed         text NOT NULL,
  -- The frozen board. Every entry carries its PPR score and its per-game team;
  -- BOTH are stripped from the pre-close payload. The team is a season
  -- fingerprint on its own — a 2015 Rams row says St. Louis.
  board        jsonb NOT NULL,
  opens_at     timestamptz NOT NULL,
  closes_at    timestamptz NOT NULL,
  revealed     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- The close job's read: "anything past its deadline that has not been revealed".
CREATE INDEX IF NOT EXISTS idx_puzzle_days_close
  ON puzzle_days (closes_at) WHERE NOT revealed;

-- No-repeat draw: "which (season, week) have already been used".
CREATE INDEX IF NOT EXISTS idx_puzzle_days_drawn
  ON puzzle_days (season_year, week);

CREATE TABLE IF NOT EXISTS puzzle_entries (
  id           serial PRIMARY KEY,
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  puzzle_date  date NOT NULL REFERENCES puzzle_days(puzzle_date) ON DELETE CASCADE,
  lineup       jsonb NOT NULL,
  -- score = base_score * (1 + bonus_pct). base_score is the drop-worst PPR
  -- total; keeping both means a wrong bonus can be recomputed without replaying
  -- the lineup.
  score        numeric,
  base_score   numeric,
  bonus_pct    numeric NOT NULL DEFAULT 0,
  guess_season integer,
  guess_week   integer,
  locked_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- ONE ENTRY PER PERSON PER DAY. Enforced here rather than in a handler,
  -- because a race between two tabs is exactly how a second entry gets in.
  UNIQUE (user_id, puzzle_date)
);

-- The percentile band, computed per request against the day's field.
CREATE INDEX IF NOT EXISTS idx_puzzle_entries_day_score
  ON puzzle_entries (puzzle_date, score DESC NULLS LAST);

COMMENT ON TABLE puzzle_days IS
  'One Daily puzzle per ET day. board jsonb is FROZEN at creation - the corpus tables it derives from are not stable.';
COMMENT ON COLUMN puzzle_days.board IS
  'Frozen player list. Each entry carries score and team, both STRIPPED from any pre-close payload (team is a season fingerprint).';
COMMENT ON TABLE puzzle_entries IS
  'One lineup per user per day (UNIQUE user_id, puzzle_date). score = base_score * (1 + bonus_pct).';
