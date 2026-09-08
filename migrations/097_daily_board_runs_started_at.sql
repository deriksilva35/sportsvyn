-- 097_daily_board_runs_started_at.sql
-- ============================================================================
-- THE ATTEMPT IS CONSUMED AT START, NOT AT SUBMIT.
--
-- 090 created daily_board_runs as a SUBMIT-ONLY table: every column NOT NULL,
-- so a row could not exist until a run was graded. That made the UNIQUE
-- (board_id, user_id) constraint - and the "One attempt - this board is
-- ranked" line on the rules card - enforceable only against a SECOND SUBMIT.
-- Starting wrote nothing at all (lib/daily/seasonBoardPlay.js startClock was a
-- pure signed-in check; SeasonBoard's Start called beginTimer() and changed
-- screen). A player could open the board, read all twelve team cards, reload,
-- and start again on a fresh client-side clock, as many times as they liked,
-- and the single row they eventually submitted was indistinguishable from a
-- first attempt.
--
-- v1 never had this hole. lib/daily/entries.js:40-46: "The started_at row IS
-- the clock. It is written before the board is returned, so a player who
-- reloads mid-round gets the same deadline rather than a fresh three minutes -
-- the entry row is created empty at start, not at lock." This migration gives
-- v2 the same shape.
--
-- WHAT CHANGES, and every one of these was NOT NULL before:
--   started_at    NEW, nullable. The clock. Written at start.
--   picks         -> nullable   a started row has none yet
--   score         -> nullable   nothing to grade yet
--   pct           -> nullable
--   matched       -> nullable
--   elapsed_s     -> nullable   measured at submit, from started_at
--   completed_at  -> nullable AND its DEFAULT now() IS DROPPED
--
-- completed_at IS NOT ON THE ITEM'S LIST AND HAS TO BE. It was
-- `NOT NULL DEFAULT now()`, so an INSERT that omits it - which is exactly what
-- the start route does - would stamp a completion time on a run that has not
-- finished. todayLeaderboard ORDERs BY it and the receipt reads it; a started
-- row carrying a completion instant is a lie the rest of the system would
-- believe. Nullable, no default, set explicitly at submit.
--
-- picks IS THE SUBMITTED-OR-NOT DISCRIMINATOR. After this migration
-- "started" is picks IS NULL and "submitted" is picks IS NOT NULL, and every
-- leaderboard read filters on it. That is why picks becomes nullable rather
-- than defaulting to '[]' - an empty array is a value a buggy submit could
-- also write, while NULL is a state only the start path can produce.
--
-- SAFE ON BOTH DATABASES WITHOUT A BACKFILL: daily_board_runs holds ZERO rows
-- on DEV and ZERO on PROD, checked immediately before writing this file. Every
-- change here is a widening (NOT NULL -> NULL, plus one new nullable column),
-- so it would be safe against existing rows anyway; there simply are none.
--
-- NO CHANGE TO UNIQUE (board_id, user_id). It is what makes the start insert
-- idempotent - ON CONFLICT DO NOTHING - so a second start is a no-op returning
-- the first start's deadline, and a reload cannot buy a fresh clock.
-- ============================================================================

ALTER TABLE daily_board_runs ADD COLUMN IF NOT EXISTS started_at timestamptz;

ALTER TABLE daily_board_runs ALTER COLUMN picks        DROP NOT NULL;
ALTER TABLE daily_board_runs ALTER COLUMN score        DROP NOT NULL;
ALTER TABLE daily_board_runs ALTER COLUMN pct          DROP NOT NULL;
ALTER TABLE daily_board_runs ALTER COLUMN matched      DROP NOT NULL;
ALTER TABLE daily_board_runs ALTER COLUMN elapsed_s    DROP NOT NULL;
ALTER TABLE daily_board_runs ALTER COLUMN completed_at DROP NOT NULL;
ALTER TABLE daily_board_runs ALTER COLUMN completed_at DROP DEFAULT;

-- The leaderboards' hot path is "submitted runs for this board", and after
-- this migration that carries a NULL test on every read.
CREATE INDEX IF NOT EXISTS idx_daily_board_runs_submitted
  ON daily_board_runs (board_id) WHERE picks IS NOT NULL;

-- NO SEMICOLON INSIDE THESE STRINGS. A ';' in a quoted literal splits the
-- statement in half for any runner that splits on semicolons, which is most of
-- them - it cost one failed apply of this very file before the comments were
-- reworded. Commas and dashes only.
COMMENT ON COLUMN daily_board_runs.started_at IS
  'When the clock started, written by POST /api/daily/board/start before the '
  'board is handed to the client. The deadline is derived from it server-side, '
  'so a reload resumes the same deadline rather than getting a fresh one.';

COMMENT ON COLUMN daily_board_runs.picks IS
  'NULL until the run is submitted. picks IS NULL is the started-but-unfinished '
  'state, a DNF once the board closes. picks IS NOT NULL means graded, and '
  'every leaderboard read filters on it.';
