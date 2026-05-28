-- ============================================================================
-- Migration 010 — Per-Match Player Stats
-- ============================================================================
-- Purpose: Granular per-match player performance.
-- Powers:  - Player page Match-by-Match log (G/A/minute stamps + match rating)
--          - Player Composite calculation inputs (aggregated upward to migration 009)
--          - Match recap content (top performers + key contributions)
-- ============================================================================

CREATE TABLE player_match_stats (
  id                      serial PRIMARY KEY,
  player_id               integer NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  match_id                integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id                 integer NOT NULL REFERENCES teams(id),

  -- Appearance
  started                 boolean NOT NULL DEFAULT false,
  came_on_at_minute       integer,                          -- NULL if started
  came_off_at_minute      integer,                          -- NULL if played full match
  minutes_played          integer NOT NULL DEFAULT 0,

  -- Performance (counts)
  goals                   integer NOT NULL DEFAULT 0,
  goal_minutes            integer[],                        -- e.g. [23, 67] — drives the "1G(23')" UI on Player page
  goal_types              text[],                           -- e.g. ['header', 'left_foot'] — index-aligned with goal_minutes

  assists                 integer NOT NULL DEFAULT 0,
  assist_minutes          integer[],                        -- e.g. [38, 71]

  -- Performance (advanced)
  shots                   integer,
  shots_on_target         integer,
  xg                      numeric(5,2),
  xa                      numeric(5,2),
  passes_attempted        integer,
  passes_completed        integer,
  key_passes              integer,
  progressive_carries     integer,

  -- Defensive (mostly for non-attackers but recorded for all)
  tackles                 integer,
  interceptions           integer,
  blocks                  integer,
  clearances              integer,
  duels_won               integer,
  duels_total             integer,

  -- Goalkeeping (NULL for non-keepers)
  saves                   integer,
  goals_conceded          integer,
  punches                 integer,
  catches                 integer,

  -- Discipline
  yellow_cards            integer NOT NULL DEFAULT 0,
  red_cards               integer NOT NULL DEFAULT 0,
  fouls_committed         integer,
  fouls_drawn             integer,

  -- Sportsvyn editorial rating
  match_rating            numeric(3,1),                     -- 0.0 - 10.0
  rating_source           text NOT NULL DEFAULT 'editorial', -- 'editorial' | 'auto' | 'data_provider'

  -- Provenance
  data_provider_synced_at timestamptz,
  rating_assigned_at      timestamptz,
  rating_assigned_by      text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (player_id, match_id)
);

CREATE INDEX idx_player_match_stats_player_match ON player_match_stats(player_id, match_id);
CREATE INDEX idx_player_match_stats_match ON player_match_stats(match_id);
CREATE INDEX idx_player_match_stats_team_match ON player_match_stats(team_id, match_id);
CREATE INDEX idx_player_match_stats_goals ON player_match_stats(match_id, goals DESC) WHERE goals > 0;

COMMENT ON TABLE player_match_stats IS 'Per-match player performance. Powers Match-by-Match log on Player page (G/A with minute stamps + match rating). Aggregates upward into player_tournament_stats (migration 009).';
COMMENT ON COLUMN player_match_stats.goal_minutes IS 'Array of minute stamps when this player scored. Index-aligned with goal_types. Example: [23, 67] renders as "1G (23'') + 1G (67'')" in the UI.';
COMMENT ON COLUMN player_match_stats.match_rating IS 'Sportsvyn 0.0-10.0 editorial rating. Default source is the editorial team (set in admin CMS); fallback is auto-generated from event data.';
