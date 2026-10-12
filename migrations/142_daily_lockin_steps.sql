-- 142_daily_lockin_steps.sql - the Daily's lock-in, recorded step by step (mon-4).
--
-- THE RULES: choosing a team COMMITS the run to a player from that team; a
-- placed player is FINAL; a team's players are shown only once it is chosen.
-- The server enforces them, so every choice is written as it happens:
--   steps = { "committed": <teamKey|null>, "picks": [{ slotIndex, teamKey, playerName }, ...] }
-- on the signed-in run (daily_board_runs) and the guest run (daily_guest_runs).
-- A run that STARTED BEFORE THIS (steps NULL) keeps the old submit-all path, so
-- runs in progress at deploy keep their picks; a run with steps is graded from
-- its steps and nothing else (lib/daily/lockIn.js).
--
-- ADDITIVE (number 142: 140 and 141 are taken on DEV's ledger by mock-nfl-2).
-- UNDO: ALTER TABLE daily_board_runs DROP COLUMN steps; ALTER TABLE daily_guest_runs DROP COLUMN steps;
ALTER TABLE daily_board_runs ADD COLUMN IF NOT EXISTS steps jsonb;
ALTER TABLE daily_guest_runs ADD COLUMN IF NOT EXISTS steps jsonb;
