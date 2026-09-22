-- 112_october_contest_shape.sql — a date-keyed contest that is not the Daily,
-- and the one index the burn read needs.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. THE CHECK CONSTRAINT NAMES A GAME, AND THAT IS THE BUG
-- ─────────────────────────────────────────────────────────────────────────
-- contests_week_shape today reads:
--
--   CHECK ( (game_type =  'daily' AND puzzle_date IS NOT NULL)
--        OR (game_type <> 'daily' AND season_year IS NOT NULL
--                                 AND week IS NOT NULL) )
--
-- It is trying to say something true and useful — a contest is keyed by a DAY
-- or by a WEEK, never by neither — but it says it by naming one game. So the
-- second date-keyed game this product ever builds is rejected by the table,
-- which is exactly what happened: October's first insert failed with
-- contests_week_shape on a row whose puzzle_date was 2025-09-30 and whose week
-- was, correctly, null. Baseball has no weeks; migration 110's own comment
-- says so about matches, and it is just as true here.
--
-- THE REPLACEMENT SAYS THE SHAPE RULE WITHOUT NAMING A GAME. Date-keyed or
-- week-keyed, and the two unique indexes that already exist on the table
-- enforce one-per-key for each form:
--   idx_contests_date  UNIQUE (game_type, sport, puzzle_date) WHERE date NOT NULL
--   idx_contests_week  UNIQUE (game_type, sport, season_year, week) WHERE date NULL
-- so nothing about uniqueness changes, and no existing row moves: every daily
-- row satisfies the first arm and every week-keyed row the second. Verified by
-- the NOT VALID / VALIDATE pair below, which will refuse to validate if any
-- row disagrees rather than taking the constraint on trust.
--
-- season_year STAYS REQUIRED ON BOTH ARMS. An October card belongs to a
-- postseason, the burn read is scoped by it, and a contest that cannot say
-- which year it is from is a row no leaderboard can bound.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 2. THE BURN READ'S INDEX
-- ─────────────────────────────────────────────────────────────────────────
-- NO NEW TABLE, per the relay's own preference, and none is warranted: "which
-- players has this reader already used?" is a question the entries already
-- answer. A used_players table would be a second copy of the lineups, written
-- by a job, able to disagree with them — and the first time it did, a reader
-- would be refused a player they never picked, or handed one they had.
--
-- WHAT THE SPINE LACKED was a way in BY USER. The burn read walks one reader's
-- entries across every October day; the existing (contest_id) index answers
-- the opposite question, finding all 200 entries of a day so the reader's one
-- can be filtered out of them, thirty times over. Fine in week one, wrong
-- shape, and contest_entries is shared with the Daily, the Weekly, Pick'em and
-- the Draft.
--
-- (user_id, contest_id) SERVES EVERY PER-READER READ in the product.
--
-- IDEMPOTENT throughout.

ALTER TABLE contests DROP CONSTRAINT IF EXISTS contests_week_shape;

ALTER TABLE contests ADD CONSTRAINT contests_key_shape CHECK (
  (puzzle_date IS NOT NULL AND season_year IS NOT NULL)
  OR
  (puzzle_date IS NULL AND season_year IS NOT NULL AND week IS NOT NULL)
) NOT VALID;

-- VALIDATE SEPARATELY so the scan is its own step and a disagreeing row is
-- named rather than silently blocking the DDL.
ALTER TABLE contests VALIDATE CONSTRAINT contests_key_shape;

CREATE INDEX IF NOT EXISTS contest_entries_user_idx
  ON contest_entries (user_id, contest_id);

COMMENT ON CONSTRAINT contests_key_shape ON contests IS
  'A contest is keyed by a DAY (puzzle_date) or by a WEEK (season_year+week). Replaces contests_week_shape, which said the same thing by naming game_type=''daily'' and so rejected October - the second date-keyed game. season_year is required on both arms: every contest belongs to a season.';

COMMENT ON INDEX contest_entries_user_idx IS
  'Per-reader entry lookup. Added for October''s burn read (one reader''s lineups across every postseason day); serves every other "my entries" read too. The pre-existing (contest_id) index answers the opposite question.';
