-- ============================================================================
-- 090_daily_v2_boards.sql — the season-roster Daily (v2): one frozen board
-- per ET edition day, and one run per user per board.
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 089 is the highest in the tree, so
-- this is 090.
--
-- THE BOARD IS FROZEN, NOT DERIVED, same discipline as puzzle_days (064).
-- nfl_player_season_totals moves (footballdb re-classification passes, BDL
-- backfills widening the corpus) - a re-run that reclassified one player
-- would silently change a board someone was mid-run on. board jsonb and
-- best_roster jsonb are the frozen bytes; ceiling is stored alongside them
-- rather than recomputed at read time (standing ruling), because best_roster
-- IS the ceiling's own receipt - recomputing it later could drift from the
-- board actually served if the solver ever changes.
--
-- EDITION DAY IS THE KEY, NOT A SEED ALONE. edition_date is ET (the existing
-- todayEt(), lib/daily/entries.js - no second date function). UNIQUE on
-- edition_date is what makes ensureBoardForDate's "has today's board already
-- been drawn" question a single indexed lookup, and what makes "one board
-- per edition, the same for everyone" a constraint, not a convention.
--
-- ONE ATTEMPT PER USER PER EDITION: daily_board_runs.user_id is the SAME key
-- puzzle_entries already uses (integer, REFERENCES users(id) - v1 Daily has
-- no anonymous play, confirmed against lib/daily/entries.js and
-- app/daily/page.js's own requireSignInInShell gate). UNIQUE (board_id,
-- user_id) is the constraint; SETTLED IS FINAL is an application discipline
-- (a completed run row is never updated) this migration does not enforce by
-- itself - there is no UPDATE trigger here, because the write path simply
-- never issues one.
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_boards (
  id           serial PRIMARY KEY,
  edition_date date NOT NULL UNIQUE,
  season_year  integer NOT NULL,
  seed         text NOT NULL,
  -- The frozen draw: twelve teams, each team's card. Same shape
  -- generateBoard() returns, stripped of nothing - unlike puzzle_days, this
  -- board has no pre-reveal secrecy requirement (rule (d) never existed here,
  -- there is no hidden season/week to guess).
  board        jsonb NOT NULL,
  ceiling      numeric NOT NULL,
  -- The solver's own slot assignment for the best roster - [{slot, teamKey,
  -- player}] in SLOTS order, exactly assignmentSolver.js's solveBoard()
  -- bySlot shape. Stored, not recomputed: this IS what `ceiling` is the sum
  -- of, and seasonBoardGrade's per-row pairing reads directly off it.
  best_roster  jsonb NOT NULL,
  opens_at     timestamptz NOT NULL,
  closes_at    timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_board_runs (
  id           serial PRIMARY KEY,
  board_id     integer NOT NULL REFERENCES daily_boards(id) ON DELETE CASCADE,
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  picks        jsonb NOT NULL,
  score        numeric NOT NULL,
  pct          numeric NOT NULL,
  matched      integer NOT NULL,
  elapsed_s    integer NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  -- ONE ATTEMPT PER USER PER EDITION. Enforced here, not just in the route -
  -- a race between two tabs is exactly how a second run gets in.
  UNIQUE (board_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_board_runs_board
  ON daily_board_runs (board_id);

COMMENT ON TABLE daily_boards IS
  'One season-roster Daily board per ET edition day (UNIQUE edition_date). board, ceiling, and best_roster are FROZEN at creation - never recomputed at read time.';
COMMENT ON COLUMN daily_boards.best_roster IS
  'The solver''s own slot assignment for the best roster, [{slot, teamKey, player}] in SLOTS order (assignmentSolver.js solveBoard() bySlot shape) - what ceiling sums, and what grading pairs each user pick against, slot for slot.';
COMMENT ON TABLE daily_board_runs IS
  'One completed run per user per board (UNIQUE board_id, user_id). SETTLED IS FINAL - a run row is never updated after insert.';

-- ---------------------------------------------------------------------------
-- VERIFY (DEV first, then PROD, only on explicit GO):
--   \d daily_boards
--   \d daily_board_runs
--   SELECT count(*) FROM daily_boards;      -- expect 0 immediately after apply
--   SELECT count(*) FROM daily_board_runs;  -- expect 0 immediately after apply
-- ---------------------------------------------------------------------------
