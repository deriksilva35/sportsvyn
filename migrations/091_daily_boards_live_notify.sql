-- ============================================================================
-- 091_daily_boards_live_notify.sql — daily-live fires at 10:00 AM ET on the
-- edition date, not at open (amendment to 5b). daily_boards gets its own
-- column for the boundary rather than the tick computing 10am inline, so the
-- rule "the tick carries no hour constants and no DST logic" stays literal -
-- every push boundary the tick reads is a column on the board row.
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 090 is the highest in the tree, so
-- this is 091.
--
-- NO BACKFILL CLAUSE: zero rows exist on PROD (090 was applied there with an
-- empty table, confirmed at the time), so there is nothing to backfill -
-- every future row gets live_notify_at from ensureBoardForDate at INSERT
-- time, same as opens_at/closes_at.
-- ============================================================================

ALTER TABLE daily_boards ADD COLUMN IF NOT EXISTS live_notify_at timestamptz;

COMMENT ON COLUMN daily_boards.live_notify_at IS
  'When daily-live fires for this edition - 10:00 AM America/New_York on edition_date, computed via easternLocalToUtc at board-creation time (ensureBoardForDate). The tick reads this column, never a fixed hour.';

-- ---------------------------------------------------------------------------
-- VERIFY (DEV first, then PROD, only on explicit GO):
--   \d daily_boards
--   SELECT count(*) FROM daily_boards WHERE live_notify_at IS NULL;
--     -- expect 0 on PROD (table is empty); on DEV, existing test rows from
--     -- before this migration will show NULL until re-created - harmless,
--     -- they are throwaway sentinel/synthetic rows, never real editions.
-- ---------------------------------------------------------------------------
