-- ============================================================================
-- 088_season_totals_longs_and_bdl.sql — the Longs, and room for the modern
-- half of nfl_player_season_totals.
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 087 is the highest in the tree, so
-- this is 088. Scanned the target first: nfl_player_season_totals exists (087,
-- applied, 10,490 footballdb rows on it already) with neither rush_long nor
-- rec_long, and matched_by's CHECK allows only ('exact', 'created').
--
-- 087 ITSELF IS NOT TOUCHED. It already holds real, verified data (the James
-- Stewart traded-row proof, the Kellen Winslow identity case, 20 seasons of
-- census-clean parsing) - this is a follow-on ALTER, the same pattern 047
-- added stdev/bye to sim_player_pool after 046 created it, not a rewrite of
-- history.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. rush_long, rec_long — MAX, never SUM, and that is the whole reason they
-- get their own migration rather than riding in with the rest of 087's
-- columns. nfl_player_game_stats does not carry them at all (checked: no
-- rush_long/rec_long column exists there), so the modern half of this table
-- will be the FIRST place they are ever stored for NFL - derived at
-- aggregation time as MAX(per-game rush/rec yardage on that play) is not
-- available either; game grain doesn't carry a per-play long, only footballdb's
-- season tabs do (the Rushing/Receiving "Lg" column). So for 1980-1999 this is
-- a real number, backfilled from the source; for 2015-2025 it is column that
-- SHOULD exist for shape-parity between the two halves but has no honest value
-- to fill without per-game/per-play data neither BDL's stat rows nor our
-- ingest of them carries - left NULL there, not zero, not guessed.
-- ---------------------------------------------------------------------------
ALTER TABLE nfl_player_season_totals ADD COLUMN IF NOT EXISTS rush_long integer;
ALTER TABLE nfl_player_season_totals ADD COLUMN IF NOT EXISTS rec_long integer;

COMMENT ON COLUMN nfl_player_season_totals.rush_long IS
  'Longest rushing play of the season stint. MAX semantics if ever re-derived from a finer grain - NEVER summed. footballdb backfilled from the Rushing tab''s Lg column (a trailing "t" means the long play was a touchdown; stripped before storage - see lib/footballdb/parse.js). NULL for BDL-derived (2015-2025) rows: no per-play long exists in nfl_player_game_stats to aggregate from.';
COMMENT ON COLUMN nfl_player_season_totals.rec_long IS
  'Longest receiving play of the season stint. Same MAX rule and the same NULL-for-BDL-rows reason as rush_long. footballdb backfilled from the Receiving tab''s Lg column.';
COMMENT ON COLUMN nfl_player_season_totals.fg_long IS
  'Longest field goal of the season stint. MAX semantics - already true of how this column was populated for footballdb rows (the source''s own season-max), stated explicitly now that rush_long/rec_long make the pattern a rule rather than an accident. For BDL-derived rows this one CAN be aggregated honestly: nfl_player_game_stats.fg_long already exists per game, so MAX(fg_long) across the group is real, not guessed.';

-- ---------------------------------------------------------------------------
-- 2. matched_by gains a third value for rows that never went through
-- footballdb's name-resolution at all. A BDL-derived season row's
-- nfl_player_id comes straight off nfl_player_game_stats.nfl_player_id -
-- already correct by construction, since that table only ever holds rows for
-- a player BDL's own sync already identified. Calling that 'exact' would
-- overload the word to mean two different processes (footballdb-name-matched-
-- to-an-existing-row vs never-needed-to-match-at-all); 'created' is simply
-- false for it. 'summed' names what actually happened: the row IS the SUM (and
-- MAX, for the Longs) of that player's real game rows for that season and
-- team - the provenance the source column also carries, redundantly and
-- deliberately, the same double-telling 083 already does for `source`.
-- ---------------------------------------------------------------------------
ALTER TABLE nfl_player_season_totals DROP CONSTRAINT IF EXISTS nfl_player_season_totals_matched_by_check;
ALTER TABLE nfl_player_season_totals
  ADD CONSTRAINT nfl_player_season_totals_matched_by_check
  CHECK (matched_by IN ('exact', 'created', 'summed'));

COMMENT ON COLUMN nfl_player_season_totals.matched_by IS
  'How nfl_player_id was resolved. exact/created: footballdb name-resolution outcome (see identity.js) - ambiguous is refused and never reaches this table. summed: a BDL-derived row, identity already known from nfl_player_game_stats, no name resolution involved.';

-- ---------------------------------------------------------------------------
-- VERIFY (DEV first, then PROD):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='nfl_player_season_totals' AND column_name IN ('rush_long','rec_long');
--     -- expect: both present
--   SELECT count(*) FROM nfl_player_season_totals WHERE rush_long IS NOT NULL;
--     -- expect: 0 immediately after this migration (backfill is a separate step)
--   INSERT INTO nfl_player_season_totals
--     (nfl_player_id, season_year, team_key, position, matched_by, raw_name, source)
--     VALUES (<any real nfl_players.id>, 2015, 'Green Bay Packers', 'QB', 'summed', 'Aaron Rodgers', 'bdl');
--     -- expect: succeeds now, would have violated the old CHECK before this migration.
--     -- Then DELETE it.
-- ---------------------------------------------------------------------------
