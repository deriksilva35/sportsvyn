-- ============================================================================
-- 087_footballdb_season_totals.sql — season totals, for the season that IS the
-- board (the-daily-v2-product-spec.md section 8).
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 086 is the highest in the tree, so
-- this is 087. Scanned the target first: no table by this name exists on
-- either database, and nothing else in the schema carries season-total (as
-- opposed to per-game) offensive/kicking/defensive stat lines for a player.
--
-- WHY NOT nfl_player_game_stats. That table is GAME grain, one row per player
-- per match, and the new season-roster mechanic has no match to key off of -
-- it draws a whole season, one player per team, scored on that player's SEASON
-- total. Forcing a season total through a game-grain table would mean
-- inventing a synthetic "game" that never happened. Season totals get their
-- own table, in the SAME column vocabulary as nfl_player_game_stats, so
-- fantasyPoints() scores a season row with the same function it already scores
-- a game row with - one scorer, two grains of input, never two answers to the
-- same question.
-- ============================================================================

CREATE TABLE IF NOT EXISTS nfl_player_season_totals (
  id                serial      PRIMARY KEY,
  nfl_player_id     integer     NOT NULL REFERENCES nfl_players(id) ON DELETE CASCADE,
  season_year       integer     NOT NULL,
  -- THE RAW SOURCE TEAM NAME, DELIBERATELY NOT A TEAMS.ID FK. footballdb's
  -- "Team" column is a full franchise name at the time ("Houston Oilers",
  -- "St. Louis Rams", "Los Angeles Raiders") and our teams table holds only
  -- the 32 CURRENT franchises - measured, a search for "Oilers" or "St.
  -- Louis" against teams returns nothing. Resolving 1980-1999 names to a
  -- modern franchise id would need a lineage table (Oilers -> Titans, Rams
  -- LA -> STL -> LA, Raiders LA -> Oakland -> LV, Cardinals STL -> Phoenix ->
  -- Arizona, Colts Baltimore -> Indianapolis, ...) that nothing here has
  -- built, and the season-roster draw does not need one: the team COUNT it
  -- reads comes from each workbook's own About tab, never from this table's
  -- distinct team_key count, and a draw is scoped to one season at a time so
  -- "which modern team is this" never has to be asked.
  team_key          text        NOT NULL,
  position          text        NOT NULL,
  -- A PLAYER TRADED MID-SEASON IS TWO ROWS, ONE PER TEAM, NEVER SUMMED HERE.
  -- footballdb's own About tab says so - "A player who played for two teams
  -- appears once per team (per-team splits, as footballdb lists them)" - and
  -- the season-roster draw needs exactly that: James Stewart's Jacksonville
  -- row OR his Minnesota row, picked by the draw, never a synthetic combined
  -- one. The career index (which DOES want an all-teams total) sums across
  -- rows at READ time; storage keeps the fact the source gives it.
  games             integer,
  pass_cmp          integer,
  pass_att          integer,
  pass_yds          integer,
  pass_td           integer,
  pass_int          integer,
  rush_att          integer,
  rush_yds          integer,
  rush_td           integer,
  rec               integer,
  rec_yds           integer,
  rec_td            integer,
  -- fumbles_lost, tgt AND fr (fumble recoveries) HAVE NO SOURCE IN footballdb.
  -- Not a per-season cutoff - the columns do not exist in ANY of the 20 tabs
  -- across 1980-1999, confirmed by an exhaustive header census. NULL for
  -- every row this ingest writes, forever, not a value this source can ever
  -- supply. NULL rather than 0: "we do not know" is not "he had none".
  fumbles_lost      integer,
  fgm               integer,
  fga               integer,
  fg_long           integer,
  xp                integer,
  -- SACK: NULL for 1980-1981 (not officially tracked by the NFL until 1982),
  -- real from 1982. Detected from the SOURCE CELL, not the season number -
  -- footballdb marks an untracked stat '--' and the importer writes NULL
  -- whenever it sees that marker, on any column, any year. No season branch.
  sacks             numeric,
  def_int           integer,
  def_td            integer,
  -- MATCHED_BY: how nfl_player_id was resolved. 'exact' - one nfl_players row
  -- shares (normalized_name, team_key, season_year)'s player and no other
  -- candidate does. 'created' - no candidate existed at all; ~71% of a given
  -- season's names, measured on 1995, since most 1980s-90s careers ended
  -- before BDL's own 2002 floor. 'ambiguous' NEVER APPEARS HERE - an
  -- ambiguous identity is refused at ingest and reported, never written on a
  -- guess.
  matched_by        text        NOT NULL CHECK (matched_by IN ('exact', 'created')),
  -- THE SOURCE'S OWN STRING, KEPT. footballdb writes "Last, First" order;
  -- this is that raw text, before the reorder-then-normalize the identity
  -- match runs on - an audit trail back to what the workbook actually said,
  -- independent of whatever nfl_players.full_name ends up reading.
  raw_name          text        NOT NULL,
  source            text        NOT NULL DEFAULT 'footballdb',
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nfl_player_season_totals_key UNIQUE (nfl_player_id, season_year, team_key)
);

CREATE INDEX IF NOT EXISTS idx_nfl_player_season_totals_season
  ON nfl_player_season_totals (season_year);

COMMENT ON TABLE nfl_player_season_totals IS
  'Season-total player stat lines from footballdb workbooks (1980-1999 initially). One row per (player, season, team) - a traded player is two rows, never summed at ingest. Feeds the season-roster board draw directly (native grain) and the career-to-date resume index (summed across rows there, not here). See migrations/087 and lib/footballdb/.';

-- ---------------------------------------------------------------------------
-- VERIFY (DEV first, then PROD):
--   SELECT count(*) FROM nfl_player_season_totals;                 -- expect 0 pre-ingest
--   SELECT conname FROM pg_constraint
--    WHERE conrelid='nfl_player_season_totals'::regclass;          -- expect the FK, the
--                                                                   -- CHECK, and the UNIQUE key
--   INSERT INTO nfl_player_season_totals
--     (nfl_player_id, season_year, team_key, position, matched_by, raw_name)
--     VALUES (<any real nfl_players.id>, 1995, 'Green Bay Packers', 'QB', 'exact', 'Favre, Brett');
--     -- expect: succeeds. Then DELETE it.
--   INSERT ... matched_by='ambiguous' ...   -- expect: violates the CHECK constraint
-- ---------------------------------------------------------------------------
