-- 063_nfl_player_seasons.sql — what position a player played, per season.
--
-- WHY A TABLE AND NOT A COLUMN. nfl_players.position is a CURRENT-ROSTER fact
-- sourced from balldontlie, and BDL drops it when a player retires: 91% of 2015
-- offensive producers come back 'UNK' (Greg Jennings, Brandon Marshall, Eric
-- Decker, Ryan Fitzpatrick). The historical corpus therefore cannot be labelled
-- from the column the sim already reads, and overwriting that column with
-- historical guesses would corrupt the one thing the draft room depends on.
--
-- NO TEAM COLUMN, DELIBERATELY. A player-season is not one team — 113 of 2,065
-- players in the 2015 roster file carry more than one stint — and the team that
-- matters is already on the stat row, per game, correct for trades. The
-- roster-stint team IS used, but only transiently, by the matcher deciding
-- which BDL player a nflverse name refers to. It is discarded afterwards rather
-- than stored as a half-truth.
--
-- SOURCE is nflverse (CC-BY-4.0), which keeps positions for retired players
-- where BDL does not: 17,833 of 17,833 players whose careers ended before 2018
-- carry one.

CREATE TABLE IF NOT EXISTS nfl_player_seasons (
  nfl_player_id  integer NOT NULL REFERENCES nfl_players(id) ON DELETE CASCADE,
  season_year    integer NOT NULL,
  position       text    NOT NULL,
  -- Provenance, so a wrong label can be traced to the rule that produced it
  -- rather than argued about. 'override' | 'unique' | 'team' | 'profile'.
  matched_by     text    NOT NULL,
  -- nflverse's own key, kept for re-runs and spot checks. Not a foreign key:
  -- we do not store an nflverse player table.
  gsis_id        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (nfl_player_id, season_year)
);

-- The puzzle's read: "give me every QB with a stat row in season Y".
CREATE INDEX IF NOT EXISTS idx_nfl_player_seasons_season_pos
  ON nfl_player_seasons (season_year, position);

COMMENT ON TABLE nfl_player_seasons IS
  'Per-season position from nflverse (CC-BY-4.0). Exists because nfl_players.position is a current-roster fact that BDL drops on retirement. No team column: per-game team lives on nfl_player_game_stats.';
COMMENT ON COLUMN nfl_player_seasons.matched_by IS
  'Which resolution rule produced this row: override | unique | team | profile.';
