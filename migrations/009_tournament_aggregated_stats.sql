-- ============================================================================
-- Migration 009 — Tournament Aggregated Stats
-- ============================================================================
-- Purpose: Per-tournament aggregated stats for teams and players.
-- Powers:  - Stats Hub Overview tiles + All Stats sortable table
--          - Team page Team Stats grid (GF / GA / xG / xGA / Poss%)
--          - Player page Tournament Stats grid (G / A / G+A / xG+xA / Pass% / Min)
--          - Rankings hub Top Scorers / Top Assists / G+A tiles
-- ============================================================================

-- Team-level tournament aggregates
CREATE TABLE team_tournament_stats (
  id                      serial PRIMARY KEY,
  team_id                 integer NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  league_id               integer NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,

  -- Match counts
  matches_played          integer NOT NULL DEFAULT 0,
  wins                    integer NOT NULL DEFAULT 0,
  draws                   integer NOT NULL DEFAULT 0,
  losses                  integer NOT NULL DEFAULT 0,

  -- Scoring
  goals_for               integer NOT NULL DEFAULT 0,
  goals_against           integer NOT NULL DEFAULT 0,
  goal_differential       integer NOT NULL DEFAULT 0,
  clean_sheets            integer NOT NULL DEFAULT 0,

  -- Advanced
  xg                      numeric(5,2),
  xga                     numeric(5,2),
  xgd                     numeric(5,2),
  possession_pct          numeric(4,2),
  pass_completion_pct     numeric(4,2),
  shots                   integer,
  shots_on_target         integer,

  -- Denormalized league ranks (refreshed alongside stats recomputation)
  rank_goals_for          integer,
  rank_goals_against      integer,
  rank_goal_differential  integer,
  rank_xg                 integer,
  rank_xga                integer,
  rank_possession         integer,
  rank_pass_completion    integer,

  -- Provenance + freshness
  computed_at             timestamptz NOT NULL DEFAULT now(),
  data_provider_synced_at timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (team_id, league_id)
);

CREATE INDEX idx_team_tournament_stats_league ON team_tournament_stats(league_id);
CREATE INDEX idx_team_tournament_stats_rank_goals ON team_tournament_stats(league_id, rank_goals_for) WHERE rank_goals_for IS NOT NULL;
CREATE INDEX idx_team_tournament_stats_rank_xg ON team_tournament_stats(league_id, rank_xg) WHERE rank_xg IS NOT NULL;

COMMENT ON TABLE team_tournament_stats IS 'Per-tournament team aggregates. One row per team per league. Recomputed within 2min of every match FT via match-event webhook + per-league aggregation query.';
COMMENT ON COLUMN team_tournament_stats.rank_goals_for IS 'Denormalized rank within the league. Refreshed alongside aggregate recomputation. NULL when stats haven''t been computed yet.';


-- Player-level tournament aggregates
CREATE TABLE player_tournament_stats (
  id                      serial PRIMARY KEY,
  player_id               integer NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  league_id               integer NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id                 integer NOT NULL REFERENCES teams(id),

  -- Counting stats
  matches_played          integer NOT NULL DEFAULT 0,
  starts                  integer NOT NULL DEFAULT 0,
  minutes_played          integer NOT NULL DEFAULT 0,
  goals                   integer NOT NULL DEFAULT 0,
  assists                 integer NOT NULL DEFAULT 0,
  goal_contributions      integer GENERATED ALWAYS AS (goals + assists) STORED,

  -- Advanced
  xg                      numeric(5,2),
  xa                      numeric(5,2),
  xg_plus_xa              numeric(5,2),
  shots                   integer,
  shots_on_target         integer,
  passes_attempted        integer,
  passes_completed        integer,
  pass_completion_pct     numeric(4,2),

  -- Defensive
  tackles                 integer,
  interceptions           integer,
  blocks                  integer,
  clearances              integer,

  -- Goalkeeping (NULL for non-keepers)
  saves                   integer,
  save_pct                numeric(4,2),
  goals_conceded          integer,
  clean_sheets            integer,

  -- Discipline
  yellow_cards            integer NOT NULL DEFAULT 0,
  red_cards               integer NOT NULL DEFAULT 0,

  -- Sportsvyn 5-dimension Player Composite (per the Methodology page)
  output_score            numeric(3,1),
  efficiency_score        numeric(3,1),
  impact_score            numeric(3,1),
  availability_score      numeric(3,1),
  context_score           numeric(3,1),
  composite_score         numeric(3,1),

  -- Denormalized ranks within the league
  rank_goals              integer,
  rank_assists            integer,
  rank_goal_contributions integer,
  rank_xg_plus_xa         integer,
  rank_minutes            integer,
  rank_composite          integer,
  rank_saves              integer,  -- keepers only

  -- Provenance
  computed_at             timestamptz NOT NULL DEFAULT now(),
  data_provider_synced_at timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (player_id, league_id)
);

CREATE INDEX idx_player_tournament_stats_league ON player_tournament_stats(league_id);
CREATE INDEX idx_player_tournament_stats_team ON player_tournament_stats(team_id);
CREATE INDEX idx_player_tournament_stats_rank_composite ON player_tournament_stats(league_id, rank_composite) WHERE rank_composite IS NOT NULL;
CREATE INDEX idx_player_tournament_stats_rank_goals ON player_tournament_stats(league_id, rank_goals) WHERE rank_goals IS NOT NULL;
CREATE INDEX idx_player_tournament_stats_rank_assists ON player_tournament_stats(league_id, rank_assists) WHERE rank_assists IS NOT NULL;
CREATE INDEX idx_player_tournament_stats_rank_ga ON player_tournament_stats(league_id, rank_goal_contributions) WHERE rank_goal_contributions IS NOT NULL;

COMMENT ON TABLE player_tournament_stats IS 'Per-tournament player aggregates. One row per player per league. The 5-dimension composite (output/efficiency/impact/availability/context) is the editorial Player Composite per the Methodology page. Denormalized ranks support fast Top X queries for Rankings hub.';
COMMENT ON COLUMN player_tournament_stats.goal_contributions IS 'Generated column: goals + assists. Used directly by the G+A ranking list.';
COMMENT ON COLUMN player_tournament_stats.composite_score IS '0.0-10.0 Player Composite from 5 dimensions equally weighted. Locked methodology v1.0 May 27 2026.';
