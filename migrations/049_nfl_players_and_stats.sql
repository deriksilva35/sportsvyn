-- ============================================================================
-- 049_nfl_players_and_stats.sql  (DEV) - gridiron session 2
--
-- Adds the NFL player-identity + per-game stat layer the sim's real stats path
-- reads, and repoints the sim pool's future-join FK onto it.
--
-- New objects (all additive; soccer `players` table untouched):
--   · nfl_players            - NFL player identities, keyed on BDL player id, plus
--                              32 SYNTHETIC team-defense identities (one per team).
--   · nfl_player_game_stats  - per-player per-game structured stat rows, keyed to
--                              matches; columns are the verified consumer contract
--                              (scoring.js + statView.js on the Mac).
--   · sim_player_pool.matched_player_id FK: players(id) -> nfl_players(id). All 717
--                              rows are NULL today, so the repoint is safe.
--
-- STRUCTURED, NOT BLOBBED: one integer/numeric column per contract stat. No JSON,
-- no display strings, no season table (season totals derive by summing game rows).
--
-- BDL payload evidence (GET /nfl/v1/stats?seasons[]=2025, live 2025-07 pull):
--   stat rows are PER-PLAYER and carry {player, team, game, <stat fields>}. Column
--   map (BDL field -> our column):
--     passing_completions->pass_cmp  passing_attempts->pass_att  passing_yards->pass_yds
--     passing_touchdowns->pass_td     passing_interceptions->pass_int
--     rushing_attempts->rush_att      rushing_yards->rush_yds     rushing_touchdowns->rush_td
--     receiving_targets->tgt  receptions->rec  receiving_yards->rec_yds  receiving_touchdowns->rec_td
--     fumbles_lost->fumbles_lost
--     field_goals_made->fgm  field_goal_attempts->fga  long_field_goal_made->fg_long
--     extra_points_made->xp
--     defensive_sacks->sacks  defensive_interceptions->def_int  fumbles_recovered->fr
--     def_td = interception_touchdowns + fumbles_touchdowns
--
-- DECISION - xp attempts DROPPED: BDL /nfl/v1/stats exposes extra_points_made but
--   has NO extra-point-attempts field, and scoring.js consumes XP makes only. So
--   there is no xp_att column. (Documented so the Mac reader does not look for it.)
--
-- DECISION - DST as SYNTHETIC per-team identity rows (accepted recommendation):
--   BDL has no team-defense entity; defensive production is per defensive player
--   (defensive_sacks / defensive_interceptions / fumbles_recovered / *_touchdowns).
--   So we create one is_team_defense identity per NFL team (32; only the 18
--   FFC-ranked ones match pool rows) and DERIVE a DST's stats at read time by
--   aggregating its team's defensive player rows per game (sum sacks/def_int/fr/
--   def_td, grouped by match). No DST stat rows are materialized. scoring.js treats
--   DST as partial (sacks/def_int/fr/def_td only), so points/yards-allowed are not
--   stored here.
--
-- Reversible: DROP TABLE nfl_player_game_stats; DROP TABLE nfl_players (after
--   restoring the pool FK to players(id)).
--
-- NOTE ON NUMBERING: 048 was the highest file on this branch's base (2bbb112) at
--   transcription, so this is 049. If the Mac's main (a descendant of this base)
--   added migrations >= 049 before this branch merges, renumber this file then.
-- ============================================================================

-- ---- nfl_players: identities (real BDL players + synthetic team defenses) ----
CREATE TABLE nfl_players (
  id               serial PRIMARY KEY,
  bdl_player_id    integer UNIQUE,               -- BDL /nfl/v1 player id; NULL for synthetic DST rows
  first_name       text,
  last_name        text,
  full_name        text        NOT NULL,
  normalized_name  text        NOT NULL,          -- de-accented, lowercased, de-suffixed; the pool name-match key
  position         text        NOT NULL,          -- FFC vocab QB/RB/WR/TE/PK/DEF (BDL 'K' normalized to PK; DEF synthetic)
  bdl_position     text,                           -- raw BDL position_abbreviation (provenance; NULL for DST)
  team_id          integer     REFERENCES teams(id),
  is_team_defense  boolean     NOT NULL DEFAULT false,
  jersey_number    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- exactly one synthetic defense identity per team
CREATE UNIQUE INDEX uniq_nfl_dst_per_team ON nfl_players (team_id) WHERE is_team_defense;
-- name-match lookup (normalized_name, position)
CREATE INDEX idx_nfl_players_match ON nfl_players (normalized_name, position);

-- ---- nfl_player_game_stats: per-player per-game structured lines -------------
CREATE TABLE nfl_player_game_stats (
  id             serial PRIMARY KEY,
  match_id       integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  nfl_player_id  integer NOT NULL REFERENCES nfl_players(id) ON DELETE CASCADE,
  team_id        integer REFERENCES teams(id),     -- player's team that game; DST aggregation groups on this
  -- passing
  pass_cmp integer, pass_att integer, pass_yds integer, pass_td integer, pass_int integer,
  -- rushing
  rush_att integer, rush_yds integer, rush_td integer,
  -- receiving
  tgt integer, rec integer, rec_yds integer, rec_td integer,
  -- misc offense
  fumbles_lost integer,
  -- kicking (makes only; xp attempts intentionally absent - see header)
  fgm integer, fga integer, fg_long integer, xp integer,
  -- defense (per defensive player; a DST sums these across its team's players)
  sacks numeric, def_int integer, fr integer, def_td integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, nfl_player_id)
);
CREATE INDEX idx_nfl_stats_player ON nfl_player_game_stats (nfl_player_id);
CREATE INDEX idx_nfl_stats_match  ON nfl_player_game_stats (match_id);

-- ---- repoint the sim pool's future-join FK: players(id) -> nfl_players(id) ----
ALTER TABLE sim_player_pool DROP CONSTRAINT sim_player_pool_matched_player_id_fkey;
ALTER TABLE sim_player_pool
  ADD CONSTRAINT sim_player_pool_matched_player_id_fkey
  FOREIGN KEY (matched_player_id) REFERENCES nfl_players(id);

-- ----------------------------------------------------------------------------
-- Sanity (run after applying):
--   SELECT count(*) FROM nfl_players WHERE is_team_defense;         -- expect 32 after ingest
--   SELECT count(*) FROM nfl_player_game_stats;                     -- expect > 0 after backfill
--   SELECT conname, confrelid::regclass FROM pg_constraint
--     WHERE conname='sim_player_pool_matched_player_id_fkey';       -- expect -> nfl_players
-- ----------------------------------------------------------------------------
