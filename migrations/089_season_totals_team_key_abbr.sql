-- ============================================================================
-- 089_season_totals_team_key_abbr.sql — team_key becomes the abbreviation
-- (ruling), and the multi-team-season key gets its comment (ruling B).
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 088 is the highest in the tree, so
-- this is 089. Scanned the target first: nfl_player_season_totals exists
-- (087, 088 applied), 10,490 footballdb rows on it, team_key still holding
-- full franchise-name strings ("Green Bay Packers", "Houston Oilers", ...).
--
-- RULING B — DO NOT MERGE MULTI-TEAM SEASONS. This is schema documentation,
-- not a schema change: the UNIQUE key already enforces one row per
-- (player, season, team) and nothing here alters that. The comment exists so
-- the next person staring at two rows for the same player in the same season
-- reaches for the explanation before reaching for a merge.
-- ============================================================================
COMMENT ON CONSTRAINT nfl_player_season_totals_key ON nfl_player_season_totals IS
  'A player traded mid-season is TWO ROWS here, one per team, ON PURPOSE - never merge them. footballdb''s own convention (its About tab: a traded player appears once per team) and this key is what carries it forward: (player, season, team) is the natural grain, not (player, season). The season-roster board draws ONE of a player''s rows for a season (whichever team the draw lands on); the career-to-date index sums ACROSS a player''s rows at READ time, not here. Seeing two rows for one player-season is the traded-player case working correctly, not a duplicate to collapse - confirmed on real 2019 in-season trades (Mohamed Sanu, Emmanuel Sanders, Zay Jones, and others) and on 1980-1999 cases before them (James Stewart, 1999).';

-- ---------------------------------------------------------------------------
-- RULING C — team_key BECOMES THE TEAM ABBREVIATION, resolved from teams.
-- No nfl_teams table and no existing team-name join exist anywhere in this
-- codebase (grepped: lib/footballdb/identity.js explicitly says team is
-- "never the join key itself" for footballdb rows - there is nothing to
-- reuse). This migration does not itself write data - the resolution is a
-- data operation (scripts/team-key-abbreviate.mjs for the footballdb half;
-- scripts/bdl-season-totals-backfill.mjs computes it directly off team_id,
-- with zero misses possible, for the BDL half) - but the column stays `text`,
-- nothing here needs a type change, so the comment is the only DDL this
-- migration carries.
--
-- FOOTBALLDB ROWS WHOSE RAW TEAM STRING IS NOT A CURRENT FRANCHISE'S NAME
-- STAY AS-IS, DELIBERATELY, RATHER THAN GUESSED. teams holds one row per
-- CURRENT franchise (32 rows, current name only - no lineage/era history,
-- same fact 087's own header already established for the team_key ->
-- teams.id question). A footballdb row naming "Houston Oilers" or "St. Louis
-- Rams" has no current-franchise row to resolve against without a lineage
-- table this codebase does not have; per ruling, that is reported as a miss,
-- not papered over with a lineage guess. Measured before the update ran:
-- 1,824 of 10,490 footballdb rows (17%) carry one of ten historical names
-- with no current match - see the ingest report for the full list and counts.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN nfl_player_season_totals.team_key IS
  'The team abbreviation (teams.abbreviation, e.g. "GB", "SF") where it resolves. For BDL-derived rows (source=''bdl'') this always resolves - team_id is a real FK already. For footballdb rows (source=''footballdb''), this resolves only when the workbook''s raw team name matches a CURRENT franchise''s name exactly; a historical name with no current match (Houston Oilers, St. Louis/Phoenix Cardinals, Baltimore Colts, San Diego/LA-era Chargers and Raiders, Washington Redskins, ...) is left as footballdb''s own raw name string, UNRESOLVED - not guessed via an invented lineage table. Mixed content is the honest state, not a bug: an abbreviation where one exists, the source''s own string where it does not.';

-- ---------------------------------------------------------------------------
-- VERIFY (DEV first, then PROD):
--   SELECT team_key, count(*) FROM nfl_player_season_totals
--     WHERE source='footballdb' AND team_key !~ '^[A-Z]{2,3}$'
--     GROUP BY team_key ORDER BY count(*) DESC;
--     -- expect: the ten historical names above, nothing else
--   SELECT count(*) FROM nfl_player_season_totals
--     WHERE source='bdl' AND team_key !~ '^[A-Z]{2,3}$';
--     -- expect: 0 - BDL team_key always resolves
-- ---------------------------------------------------------------------------
