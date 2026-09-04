-- ============================================================================
-- 092_season_totals_matched_by_created_ambiguous.sql — a fourth matched_by
-- value: 'created-ambiguous' (ruling).
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 091 is the highest in the tree, so
-- this is 092. Scanned the target first: nfl_player_season_totals exists
-- (087-091 applied), matched_by's CHECK constraint currently allows only
-- 'exact', 'created', 'summed'.
--
-- RULING: AN AMBIGUOUS IDENTITY IS STORED, NEVER ATTACHED. The refuse-to-
-- ATTACH law is unchanged - an ambiguous footballdb row (its normalized name
-- shared by 2+ existing nfl_players rows) is NEVER written against any of
-- those existing candidates; picking one on a name-only tie is exactly the
-- guess this whole identity module exists to refuse. What changes is the
-- refuse-to-STORE behaviour: instead of dropping the row on the floor, the
-- ingest now mints a brand-new nfl_players row (never one of the colliding
-- candidates) and writes the season row against THAT - matched_by
-- 'created-ambiguous' marks it as neither a confident match nor an ordinary
-- creation, but a name the source carried with no existing identity this
-- ingest was willing to guess onto.
-- ============================================================================
ALTER TABLE nfl_player_season_totals DROP CONSTRAINT nfl_player_season_totals_matched_by_check;
ALTER TABLE nfl_player_season_totals ADD CONSTRAINT nfl_player_season_totals_matched_by_check
  CHECK (matched_by = ANY (ARRAY['exact'::text, 'created'::text, 'summed'::text, 'created-ambiguous'::text]));

-- ---------------------------------------------------------------------------
-- VERIFY (DEV first, then PROD):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conrelid = 'nfl_player_season_totals'::regclass
--     AND conname = 'nfl_player_season_totals_matched_by_check';
--     -- expect: the ARRAY literal above, 'created-ambiguous' included
-- ---------------------------------------------------------------------------
