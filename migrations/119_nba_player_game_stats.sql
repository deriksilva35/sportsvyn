-- 119_nba_player_game_stats.sql — the per-game box line for basketball.
--
-- A NEW TABLE, NOT A WIDER ONE, for the reason 110 gave baseball: football's
-- and baseball's columns mean nothing here, and a reader that forgot a sport
-- filter would sum a point guard's assists with a shortstop's.
--
-- ONE ROW PER PLAYER PER GAME, the shape /nba/v1/stats returns. Upserted on
-- (match_id, bdl_player_id): the live poller re-reads the box every tenth
-- poll of a live game and once at the final, and a re-read UPDATES the line.
--
-- COUNTING STATS ONLY. fg_pct, fg3_pct and ft_pct are derived by a reader
-- from the makes and attempts it sums; a stored rate cannot be added, and a
-- game's rate averaged across games is the wrong number.
--
-- MINUTES ARE STORED AS SECONDS. The provider sends `min` as a string - "29",
-- "04", and on some rows "29:14" - which neither adds nor compares. seconds is
-- an integer that does both; a reader renders 1754 as "29:14". A player who
-- did not play has seconds = 0 or NULL and no other line; dnp marks it.
--
-- bdl_player_id IS THE PROVIDER'S PLAYER, NOT A FOREIGN KEY: there is no
-- nba_players table and this does not invent one.

CREATE TABLE IF NOT EXISTS nba_player_game_stats (
  id              BIGSERIAL PRIMARY KEY,
  match_id        INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id         INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  bdl_player_id   TEXT    NOT NULL,
  player_name     TEXT    NOT NULL,
  position        TEXT,

  seconds         INTEGER,
  dnp             BOOLEAN NOT NULL DEFAULT false,
  pts             INTEGER,
  fgm             INTEGER,
  fga             INTEGER,
  fg3m            INTEGER,
  fg3a            INTEGER,
  ftm             INTEGER,
  fta             INTEGER,
  oreb            INTEGER,
  dreb            INTEGER,
  reb             INTEGER,
  ast             INTEGER,
  stl             INTEGER,
  blk             INTEGER,
  turnovers       INTEGER,
  pf              INTEGER,
  plus_minus      INTEGER,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT nba_pgs_match_player_uniq UNIQUE (match_id, bdl_player_id)
);

CREATE INDEX IF NOT EXISTS nba_pgs_match_idx  ON nba_player_game_stats (match_id);
CREATE INDEX IF NOT EXISTS nba_pgs_team_idx   ON nba_player_game_stats (team_id, match_id);
CREATE INDEX IF NOT EXISTS nba_pgs_player_idx ON nba_player_game_stats (bdl_player_id, match_id);

COMMENT ON TABLE nba_player_game_stats IS
  'One row per player per NBA game, from /nba/v1/stats. COUNTING STATS ONLY - percentages are derived from makes and attempts by the reader. Minutes stored as seconds. Unique on (match_id, bdl_player_id) so re-polling a live game updates a line rather than appending one.';

COMMENT ON COLUMN nba_player_game_stats.seconds IS
  'Minutes played, as seconds. The provider sends min as a string ("29", "29:14"); an integer adds and compares, and a reader renders 1754 as "29:14".';

COMMENT ON COLUMN nba_player_game_stats.bdl_player_id IS
  'The provider''s player id, as text. NOT a foreign key: there is no nba_players table yet.';
