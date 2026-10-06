-- ============================================================================
-- 131_daily_board_runs_late_claim.sql - a guest run claimed AFTER its board closed.
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 130 is the highest in the tree.
--
-- RULING (6 Oct, tue-3): a guest run claimed after the board's ET close is
-- saved to the account - the entry and the streak - but is NOT added to the
-- closed board or its counts. The run has to live in daily_board_runs for the
-- streak and the account's own history to see it, so the exclusion is a flag:
-- late_claim = true marks a run every BOARD-SCOPED read (that board's field,
-- rank, beat-%, played count, top score, league day, morning push) skips.
-- Account-scoped reads (streak, a player's own history) do not look at it.
--
-- SECOND RULING, SAME DAY: an account may claim at most ONE Daily per ET day; a
-- second claim is refused. daily_guest_runs.claimed_day (the ET date the claim
-- happened) with a partial UNIQUE (claimed_by, claimed_day) makes that a fact of
-- the table, so two devices claiming at once for one account cannot both win:
-- the loser's whole claim statement fails on the index and rolls back.
--
-- ADDITIVE AND REVERSIBLE: one NOT NULL column with a constant default
-- (metadata-only on Postgres 11+, no table rewrite). Every existing row is
-- false, so nothing already on a board moves.
--   undo: DROP INDEX uq_daily_guest_runs_claim_day;
--         ALTER TABLE daily_guest_runs DROP COLUMN claimed_day;
--         ALTER TABLE daily_board_runs DROP COLUMN late_claim;  (the last only
--   while no late claim exists; dropping it afterwards would put those runs
--   onto closed boards)
-- ============================================================================

ALTER TABLE daily_board_runs
  ADD COLUMN IF NOT EXISTS late_claim boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN daily_board_runs.late_claim IS
  'true = a guest run claimed after the board closed: on the account (streak, history), on NO board field or board count. Board-scoped reads filter NOT late_claim.';

ALTER TABLE daily_guest_runs ADD COLUMN IF NOT EXISTS claimed_day date;

CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_guest_runs_claim_day
  ON daily_guest_runs (claimed_by, claimed_day) WHERE claimed_by IS NOT NULL AND claimed_day IS NOT NULL;
