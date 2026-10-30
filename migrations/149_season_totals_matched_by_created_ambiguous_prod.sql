-- ============================================================================
-- 149_season_totals_matched_by_created_ambiguous_prod.sql - re-assert 092's
-- matched_by CHECK, 'created-ambiguous' included (fri-10).
--
-- WHY A NEW FILE. 092 is in PROD's ledger ("backfilled 2026-10-05: verified
-- 1/1 objects"), but PROD's constraint still allows only exact/created/summed:
-- the backfill checked that the constraint EXISTS, not its definition. The
-- Data Keeper's 2000-2001 footballdb apply (30 Oct, 18:47Z) failed on the first
-- 'created-ambiguous' row. A migration that ran is never edited, so 092 stays
-- as is and this file carries the same definition. Idempotent: on a database
-- that already has it (DEV), it drops and re-adds the same CHECK.
--
-- NUMBER: 146 is the highest on main; 147 and 148 are taken by the coins-drum
-- branch (already in DEV's ledger), so this is 149.
-- ============================================================================
ALTER TABLE nfl_player_season_totals DROP CONSTRAINT IF EXISTS nfl_player_season_totals_matched_by_check;
ALTER TABLE nfl_player_season_totals ADD CONSTRAINT nfl_player_season_totals_matched_by_check
  CHECK (matched_by = ANY (ARRAY['exact'::text, 'created'::text, 'summed'::text, 'created-ambiguous'::text]));

-- VERIFY:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname = 'nfl_player_season_totals_matched_by_check';
--   -- expect 'created-ambiguous' in the ARRAY
