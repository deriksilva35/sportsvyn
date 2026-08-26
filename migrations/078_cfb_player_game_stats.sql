-- 078_cfb_player_game_stats.sql - CFB box scores, one row per player per game.
--
-- WIDE, like 077, and for the same reason: the pivot happens at import so the
-- render stays dumb. The column vocabulary is 077's, so one column name means
-- one thing whether you are reading a season or a single game.
--
-- BUT THE GAME ENDPOINT DOES NOT SPEAK THE SEASON ENDPOINT'S LANGUAGE, and
-- reusing 077's mapping verbatim would have produced a table of nulls.
-- Diffed against the live payload:
--
--   passing   season: ATT, COMPLETIONS, INT, PCT, TD, YDS, YPA
--             game:   AVG, C/ATT, INT, QBR, TD, YDS
--   kicking   season: FGA, FGM, LONG, PCT, PTS, XPA, XPM
--             game:   FG, LONG, PCT, PTS, XP
--
-- So three of the game endpoint's types are PAIRS IN ONE STRING - "23/30" for
-- completions-attempts, "2/3" for field goals, "3/3" for extra points - where
-- the season endpoint sends each half as its own row. They are split at import
-- into the same columns 077 uses. Verified on a real line: Jaxon Potter,
-- Washington State, 2025 week 1, C/ATT "23/30" -> pass_cmp 23, pass_att 30.
--
-- SEASON TOTALS ARE NOT COMPUTED FROM THIS TABLE. 077 holds them, imported
-- from the season endpoint, and stays the single source for a season number.
-- One source of truth per number: two independent tallies of the same figure
-- is a disagreement waiting to be discovered by a reader.
--
-- opponent and result are DENORMALISED onto the row. The log renders "at TCU /
-- W 27-24" and deriving that at read means joining matches and teams twice for
-- four rows; it is written once, at import, from the game we already fetched.
--
-- Reversible: DROP TABLE cfb_player_game_stats.

CREATE TABLE IF NOT EXISTS cfb_player_game_stats (
  player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  -- The FK that costs us a quarter of the payload, correctly: CFBD returns
  -- every division (191 games in 2025 week 1) and we hold 142 of them. A stat
  -- row for a game we do not carry has no match to point at and is counted and
  -- skipped, never stored orphaned.
  match_id       INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  season         INTEGER NOT NULL,
  week           INTEGER,
  season_phase   TEXT,
  team_name      TEXT,
  opponent       TEXT,
  result         TEXT,

  pass_yds       INTEGER      ,   -- passing / YDS
  pass_td        INTEGER      ,   -- passing / TD
  pass_int       INTEGER      ,   -- passing / INT
  rush_car       INTEGER      ,   -- rushing / CAR
  rush_yds       INTEGER      ,   -- rushing / YDS
  rush_td        INTEGER      ,   -- rushing / TD
  rush_long      INTEGER      ,   -- rushing / LONG
  rec            INTEGER      ,   -- receiving / REC
  rec_yds        INTEGER      ,   -- receiving / YDS
  rec_td         INTEGER      ,   -- receiving / TD
  rec_long       INTEGER      ,   -- receiving / LONG
  tackles_tot    NUMERIC(6,1) ,   -- defensive / TOT
  tackles_solo   NUMERIC(6,1) ,   -- defensive / SOLO
  tfl            NUMERIC(6,1) ,   -- defensive / TFL
  sacks          NUMERIC(6,1) ,   -- defensive / SACKS
  qb_hur         INTEGER      ,   -- defensive / QB HUR
  pass_def       INTEGER      ,   -- defensive / PD
  def_td         INTEGER      ,   -- defensive / TD
  def_int        INTEGER      ,   -- interceptions / INT
  int_yds        INTEGER      ,   -- interceptions / YDS
  int_td         INTEGER      ,   -- interceptions / TD
  fum            INTEGER      ,   -- fumbles / FUM
  fum_lost       INTEGER      ,   -- fumbles / LOST
  fum_rec        INTEGER      ,   -- fumbles / REC
  fg_long        INTEGER      ,   -- kicking / LONG
  kick_pts       INTEGER      ,   -- kicking / PTS
  punts          INTEGER      ,   -- punting / NO
  punt_yds       INTEGER      ,   -- punting / YDS
  punt_long      INTEGER      ,   -- punting / LONG
  punt_in20      INTEGER      ,   -- punting / In 20
  punt_tb        INTEGER      ,   -- punting / TB
  kr             INTEGER      ,   -- kickReturns / NO
  kr_yds         INTEGER      ,   -- kickReturns / YDS
  kr_td          INTEGER      ,   -- kickReturns / TD
  kr_long        INTEGER      ,   -- kickReturns / LONG
  pr             INTEGER      ,   -- puntReturns / NO
  pr_yds         INTEGER      ,   -- puntReturns / YDS
  pr_td          INTEGER      ,   -- puntReturns / TD
  pr_long        INTEGER      ,   -- puntReturns / LONG
  pass_cmp       INTEGER      ,   -- passing / C/ATT (split)
  pass_att       INTEGER      ,   -- passing / C/ATT (split)
  fgm            INTEGER      ,   -- kicking / FG (split)
  fga            INTEGER      ,   -- kicking / FG (split)
  xpm            INTEGER      ,   -- kicking / XP (split)
  xpa            INTEGER      ,   -- kicking / XP (split)

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Idempotent: re-importing a week corrects it rather than duplicating it.
  PRIMARY KEY (player_id, match_id)
);

-- The game-log read: one player, newest game first.
CREATE INDEX IF NOT EXISTS cfb_player_game_stats_player_idx
  ON cfb_player_game_stats (player_id, season DESC, week DESC);
