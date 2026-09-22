-- 110_mlb_player_game_stats.sql — the per-game box line for baseball.
--
-- WHY A NEW TABLE AND NOT nfl_player_game_stats. That table's columns are
-- passing, rushing and receiving; not one of them means anything here, and a
-- baseball line needs at_bats, innings pitched and earned runs, which mean
-- nothing there. Widening it would give every NFL row forty null columns and
-- every MLB row thirty more, and the first reader that forgot a sport filter
-- would average a quarterback's yards with a shortstop's.
--
-- ONE ROW PER PLAYER PER GAME, HITTING AND PITCHING AND FIELDING TOGETHER,
-- because that is the shape /mlb/v1/stats returns: a position player's row has
-- every p_* column null and a reliever's has every batting column null. Two
-- tables would mean two writes and two reads for one provider row, and a
-- two-way pitcher would be a join against himself.
--
-- SEASON RATES ARE NOT STORED, and this is the load-bearing decision in the
-- file. The provider's per-game row carries avg, obp, slg and era - and they
-- are SEASON-TO-DATE rates, not the game's. Storing them on a game row makes
-- every historical row a lie the moment the next game is played: a box score
-- from April would show the average the player finished September with. The
-- counting stats are the game's and are stored; the rates are derived by a
-- reader from the counts it chooses to sum. Same defect lib/gridiron/
-- regLines.js already names for the NFL.
--
-- external_ids IS THE PROVIDER'S PLAYER, NOT A FOREIGN KEY. There is no
-- mlb_players table yet and this does not invent one: bdl_player_id is what a
-- later roster import will join on, and until then the name on the row is what
-- a box score prints. A null player_id with a name is a renderable row; a
-- foreign key to a table that does not exist is a migration that cannot apply.
--
-- IDEMPOTENT: CREATE TABLE IF NOT EXISTS, and the unique key is
-- (match_id, bdl_player_id) so a re-poll of a live game UPDATES the line
-- rather than appending a second one. A box score is re-read every few
-- minutes while a game is on; without that key a nine-inning game would leave
-- forty copies of every player.

CREATE TABLE IF NOT EXISTS mlb_player_game_stats (
  id                 BIGSERIAL PRIMARY KEY,
  match_id           INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id            INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  bdl_player_id      TEXT    NOT NULL,
  player_name        TEXT    NOT NULL,
  position           TEXT,

  -- BATTING. Counting stats only; avg/obp/slg are season rates and are not here.
  at_bats            INTEGER,
  plate_appearances  INTEGER,
  runs               INTEGER,
  hits               INTEGER,
  doubles            INTEGER,
  triples            INTEGER,
  home_runs          INTEGER,
  rbi                INTEGER,
  walks              INTEGER,
  intentional_walks  INTEGER,
  strikeouts         INTEGER,
  hit_by_pitch       INTEGER,
  stolen_bases       INTEGER,
  caught_stealing    INTEGER,
  total_bases        INTEGER,
  left_on_base       INTEGER,
  sac_bunts          INTEGER,
  sac_flies          INTEGER,
  gidp               INTEGER,

  -- PITCHING. `outs_recorded` IS THE STORED FORM, not innings pitched: the
  -- provider sends ip as 6.2, which is SIX AND TWO THIRDS and not six point
  -- two, so it does not add, average or compare as a number. Outs do all
  -- three, and a reader renders 20 outs as "6.2".
  outs_recorded      INTEGER,
  batters_faced      INTEGER,
  pitches_thrown     INTEGER,
  pitch_strikes      INTEGER,
  hits_allowed       INTEGER,
  runs_allowed       INTEGER,
  earned_runs        INTEGER,
  walks_allowed      INTEGER,
  strikeouts_pitched INTEGER,
  home_runs_allowed  INTEGER,
  wild_pitches       INTEGER,
  balks              INTEGER,
  hbp_allowed        INTEGER,
  inherited_runners  INTEGER,
  inherited_scored   INTEGER,
  wins               INTEGER,
  losses             INTEGER,
  saves              INTEGER,
  holds              INTEGER,
  blown_saves        INTEGER,
  games_started      INTEGER,

  -- FIELDING.
  putouts            INTEGER,
  assists            INTEGER,
  errors             INTEGER,
  fielding_chances   INTEGER,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT mlb_pgs_match_player_uniq UNIQUE (match_id, bdl_player_id)
);

CREATE INDEX IF NOT EXISTS mlb_pgs_match_idx  ON mlb_player_game_stats (match_id);
CREATE INDEX IF NOT EXISTS mlb_pgs_team_idx   ON mlb_player_game_stats (team_id, match_id);
CREATE INDEX IF NOT EXISTS mlb_pgs_player_idx ON mlb_player_game_stats (bdl_player_id, match_id);

COMMENT ON TABLE mlb_player_game_stats IS
  'One row per player per MLB game: hitting, pitching and fielding together, because that is the shape /mlb/v1/stats returns. COUNTING STATS ONLY - the provider''s avg/obp/slg/era on that row are SEASON-TO-DATE rates and storing them would make every historical box score show the numbers the player finished the season with. Unique on (match_id, bdl_player_id) so re-polling a live game updates a line rather than appending one.';

COMMENT ON COLUMN mlb_player_game_stats.outs_recorded IS
  'Innings pitched as OUTS. The provider sends ip as 6.2 meaning six and two thirds, which does not add, average or compare as a number; outs do all three and a reader renders 20 as "6.2".';

COMMENT ON COLUMN mlb_player_game_stats.bdl_player_id IS
  'The provider''s player id, as text. NOT a foreign key: there is no mlb_players table yet, and this does not invent one. A later roster import joins on it; until then player_name is what a box score prints.';
