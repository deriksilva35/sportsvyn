-- 077_cfb_player_stats.sql - CFB season stats, stored WIDE.
--
-- ONE ROW PER PLAYER PER SEASON. CFBD returns the season endpoint LONG - one
-- object per (player, category, statType), 139,136 of them for 2025 - so a
-- single player arrives spread across a dozen rows. The pivot happens at
-- IMPORT, not at read, so the render stays as dumb as the NFL side's: select a
-- row, print columns.
--
-- EVERY COLUMN BELOW IS NAMED AFTER A (category, statType) PAIR READ OFF THE
-- LIVE PAYLOAD. The comment on each line is the pair it came from. Two of them
-- would have been wrong by assumption:
--
--   * def_int comes from `interceptions/INT`, NOT from `defensive`. The
--     defensive category carries PD/QB HUR/SACKS/SOLO/TD/TFL/TOT and has no INT
--     at all - mapping it to defensive/INT would have produced a silently
--     all-null column on every defender's page.
--   * punt_in20 is the statType "In 20" - with a space.
--
-- AND THE COLUMN THAT IS ABSENT ON PURPOSE: games played. No category carries a
-- GP statType, so there is no games column and the render may not claim one.
--
-- DERIVED RATIOS ARE NOT STORED. PCT, AVG, YPA, YPC, YPR and YPP are all
-- functions of columns that ARE stored; a second copy is a second thing to
-- correct. The importer counts them as deliberately-unmapped rather than
-- dropping them silently, so the run summary shows them every time.
--
-- HALVES ARE REAL IN COLLEGE FOOTBALL. A shared stop is half a tackle to each
-- defender, so tackles, TFL and sacks are NUMERIC(6,1). Every other column is
-- a whole count and is INTEGER, which is what stops a receiver's catches
-- rendering as "6.0".
--
-- THIS IS WHERE THE TWO CODES DIVERGE ON PURPOSE. The NFL player page renders
-- defense as Sacks/INT/FR/TD because nfl_player_game_stats has never held a
-- tackles column. CFBD does hold one, so CFB defense renders Tkl/TFL/Sacks/INT
-- per the mock. Same table grammar, different columns, because the two
-- providers know different things.
--
-- Reversible: DROP TABLE cfb_player_season_stats.

CREATE TABLE IF NOT EXISTS cfb_player_season_stats (
  -- FK to the roster imported in 076. A stat row for a player we do not hold
  -- has nowhere to point and is counted-and-skipped by the importer rather
  -- than stored orphaned.
  player_id      INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  season         INTEGER NOT NULL,
  team_name      TEXT,
  conference     TEXT,
  position       TEXT,

  pass_att       INTEGER      ,   -- passing / ATT
  pass_cmp       INTEGER      ,   -- passing / COMPLETIONS
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
  fgm            INTEGER      ,   -- kicking / FGM
  fga            INTEGER      ,   -- kicking / FGA
  fg_long        INTEGER      ,   -- kicking / LONG
  kick_pts       INTEGER      ,   -- kicking / PTS
  xpm            INTEGER      ,   -- kicking / XPM
  xpa            INTEGER      ,   -- kicking / XPA
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

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- IDEMPOTENT BY CONSTRUCTION, the plays/rankings/roster pattern: re-importing
  -- a season corrects it rather than duplicating it.
  PRIMARY KEY (player_id, season)
);

-- The player page's read: one player, newest season first.
CREATE INDEX IF NOT EXISTS cfb_player_season_stats_player_idx
  ON cfb_player_season_stats (player_id, season DESC);
