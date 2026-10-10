-- 136_contests_match_id.sql - a contest can be keyed by ONE REAL GAME (thu-3).
--
-- THE PER-GAME DRAFT (game_type 'draft_game', lib/draftGame/) is one contest
-- per match: the pool is both teams' players and it locks at that kickoff.
-- Until now a contest was keyed by a WEEK (season_year+week) or a DAY
-- (puzzle_date), and both keys are unique per (game_type, sport) - sixteen
-- games in one NFL week would collide on idx_contests_week.
--
-- So: a nullable match_id, ONE contest per (game_type, match_id), and the week
-- index narrowed to the rows that are NOT match-keyed. A per-game row still
-- carries season_year + week (contests_key_shape, migration 112, is unchanged)
-- so every season/week reader keeps working on it.
--
-- NO ON DELETE CASCADE: a match is never deleted in production, and a test that
-- deletes one under a contest should fail loudly rather than take the contest
-- and its entries with it.
--
-- ADDITIVE except the index swap, which keeps the same uniqueness for every
-- existing row (none has a match_id).
-- UNDO: DROP INDEX idx_contests_match; DROP INDEX idx_contests_week;
--       CREATE UNIQUE INDEX idx_contests_week ON contests (game_type, sport, season_year, week)
--         WHERE puzzle_date IS NULL;
--       ALTER TABLE contests DROP COLUMN match_id;

ALTER TABLE contests ADD COLUMN IF NOT EXISTS match_id integer REFERENCES matches(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contests_match
  ON contests (game_type, match_id) WHERE match_id IS NOT NULL;

DROP INDEX IF EXISTS idx_contests_week;
CREATE UNIQUE INDEX idx_contests_week
  ON contests (game_type, sport, season_year, week)
  WHERE puzzle_date IS NULL AND match_id IS NULL;

COMMENT ON COLUMN contests.match_id IS
  'Set only for a contest about ONE game (game_type draft_game). Unique per (game_type, match_id); such rows are outside idx_contests_week.';
