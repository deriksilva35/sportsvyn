-- ============================================================================
-- Migration 011 — Rankings System (lists + editions + entries)
-- ============================================================================
-- Purpose: Structured ranking data separate from articles. Three-table system:
--          ranking_lists (catalog of rankings), ranking_editions (snapshots in
--          time), ranking_entries (one row per entity per edition).
-- Powers:  - Rankings hub (/rankings) and all deep-dives (Team Power, Player
--            Composite, Top Scorers, etc.)
--          - Power Ranking blocks on Team and Player pages
--          - Sparkline trajectory data
--          - Current State data blocks on Tag landing pages
--          - Methodology page (composite scoring + 3-layer outer composite)
-- ============================================================================

-- Catalog: what rankings exist
CREATE TABLE ranking_lists (
  id              serial PRIMARY KEY,
  slug            text NOT NULL UNIQUE,                     -- 'team-power' | 'player-composite' | 'top-scorers' | 'top-assists' | 'goal-contributions' | 'top-keepers' | 'goal-composite' | 'manager-composite'
  name            text NOT NULL,                            -- 'Team Power Rankings' | 'Player Composite' | 'Top Scorers'
  description     text,
  league_id       integer REFERENCES leagues(id) ON DELETE CASCADE,

  -- Discriminators
  entity_type     text NOT NULL CHECK (entity_type IN ('team', 'player', 'goal', 'manager')),
  list_type       text NOT NULL CHECK (list_type IN ('composite', 'raw_stat')),
  composite_type  text CHECK (composite_type IN ('team_power', 'player_composite', 'goal_composite', 'manager_composite', NULL)),

  -- Sort behaviour
  sort_direction  text NOT NULL DEFAULT 'desc' CHECK (sort_direction IN ('asc', 'desc')),
  display_limit   integer NOT NULL DEFAULT 32,              -- top N to render by default

  -- Display
  is_active       boolean NOT NULL DEFAULT true,
  display_order   integer NOT NULL DEFAULT 0,               -- order within the Rankings hub tab nav

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ranking_lists_league ON ranking_lists(league_id) WHERE league_id IS NOT NULL;
CREATE INDEX idx_ranking_lists_active ON ranking_lists(is_active, display_order) WHERE is_active = true;

COMMENT ON TABLE ranking_lists IS 'Catalog of all rankings (Team Power, Player Composite, Top Scorers, etc.). One row per ranking type per league. The 4 main lists locked May 27 2026: team-power (Methodology 3-layer outer composite), player-composite (5-dim editorial), top-scorers/top-assists/goal-contributions (raw stats).';
COMMENT ON COLUMN ranking_lists.list_type IS 'composite = editorial composite scoring with 5 dimensions (Team Power, Player Composite, Goal Composite, Manager Composite). raw_stat = direct stat ordering (Top Scorers, Top Assists, etc.).';
COMMENT ON COLUMN ranking_lists.composite_type IS 'For list_type=composite only. Determines which 5-dimension rubric applies (per Methodology page §3). NULL for raw_stat lists.';


-- Editions: snapshots in time
CREATE TABLE ranking_editions (
  id                      serial PRIMARY KEY,
  ranking_list_id         integer NOT NULL REFERENCES ranking_lists(id) ON DELETE CASCADE,
  edition_number          integer NOT NULL,                 -- 1, 2, 3, ... per ranking_list
  edition_label           text,                             -- 'Pre-tournament' | 'Edition 1' | 'Post-R32' | 'Edition 3 · Current'

  -- Methodology version this edition was scored under
  methodology_version     text NOT NULL DEFAULT '1.0',

  -- Phase 1 outer composite weights at the time of this edition (for reproducibility)
  editorial_weight        numeric(3,2) NOT NULL DEFAULT 0.70,
  sites_weight            numeric(3,2) NOT NULL DEFAULT 0.30,
  user_weight             numeric(3,2) NOT NULL DEFAULT 0.00,

  -- Publishing state
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'staged', 'published', 'superseded')),
  published_at            timestamptz,
  is_current              boolean NOT NULL DEFAULT false,

  -- Editor notes
  notes                   text,
  editor_action_summary   text,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (ranking_list_id, edition_number)
);

-- Ensure only one current edition per ranking_list
CREATE UNIQUE INDEX idx_ranking_editions_one_current
  ON ranking_editions(ranking_list_id)
  WHERE is_current = true;

CREATE INDEX idx_ranking_editions_list_published ON ranking_editions(ranking_list_id, published_at DESC);

COMMENT ON TABLE ranking_editions IS 'Snapshots of a ranking list at a point in time. Edition 1, 2, 3 etc. Editions are the source of truth for sparkline trajectory data on Team/Player pages.';
COMMENT ON COLUMN ranking_editions.is_current IS 'Exactly one edition per ranking_list is current. Enforced by partial unique index.';


-- Entries: the actual ranked rows
CREATE TABLE ranking_entries (
  id                  serial PRIMARY KEY,
  ranking_edition_id  integer NOT NULL REFERENCES ranking_editions(id) ON DELETE CASCADE,
  entity_type         text NOT NULL CHECK (entity_type IN ('team', 'player', 'goal', 'manager')),
  team_id             integer REFERENCES teams(id) ON DELETE CASCADE,
  player_id           integer REFERENCES players(id) ON DELETE CASCADE,
  -- goal_id           integer REFERENCES goals(id),       -- Phase 1.5
  -- manager_id        integer REFERENCES managers(id),    -- Phase 1.5

  rank                integer NOT NULL,
  score               numeric(4,2) NOT NULL,               -- 0.00-10.00 (composite) or raw stat value

  -- Movement vs previous edition (computed when edition is published)
  previous_rank       integer,
  rank_movement       integer,                              -- positive = improved (so #5 → #3 = +2)
  previous_score      numeric(4,2),
  score_movement      numeric(4,2),
  movement_label      text,                                 -- 'up' | 'down' | 'hold' | 'new' | 'returning'

  -- Composite breakdown (NULL for raw_stat lists)
  result_score        numeric(3,1),                        -- Team Power dim 1
  process_score       numeric(3,1),                        -- Team Power dim 2
  squad_score         numeric(3,1),                        -- Team Power dim 3
  coherence_score     numeric(3,1),                        -- Team Power dim 4
  momentum_score      numeric(3,1),                        -- Team Power dim 5

  -- Player composite dims (reused columns since rubrics never overlap on same row)
  output_score        numeric(3,1),                        -- Player dim 1
  efficiency_score    numeric(3,1),                        -- Player dim 2
  impact_score        numeric(3,1),                        -- Player dim 3
  availability_score  numeric(3,1),                        -- Player dim 4
  context_score       numeric(3,1),                        -- Player dim 5

  -- Sites layer (Team Power only — per Methodology §5 Intentional Asymmetry)
  fifa_rank           integer,
  fifa_score          numeric(4,2),                        -- after power-curve normalization
  espn_rank           integer,
  espn_score          numeric(4,2),
  sites_composite     numeric(4,2),                        -- 50/50 avg of fifa_score + espn_score
  editorial_composite numeric(4,2),                        -- the 5-dim editorial score
  -- score column above is the outer composite = (editorial * 0.70) + (sites * 0.30)

  -- Editorial blurb reference (added in migration 012)
  blurb_id            integer,

  created_at          timestamptz NOT NULL DEFAULT now(),

  CHECK (
    (entity_type = 'team' AND team_id IS NOT NULL AND player_id IS NULL) OR
    (entity_type = 'player' AND player_id IS NOT NULL AND team_id IS NULL)
  ),
  UNIQUE (ranking_edition_id, entity_type, team_id, player_id)
);

CREATE INDEX idx_ranking_entries_edition_rank ON ranking_entries(ranking_edition_id, rank);
CREATE INDEX idx_ranking_entries_team ON ranking_entries(team_id, ranking_edition_id) WHERE team_id IS NOT NULL;
CREATE INDEX idx_ranking_entries_player ON ranking_entries(player_id, ranking_edition_id) WHERE player_id IS NOT NULL;
CREATE INDEX idx_ranking_entries_movement_up ON ranking_entries(ranking_edition_id, rank_movement DESC) WHERE rank_movement > 0;

COMMENT ON TABLE ranking_entries IS 'The actual ranked rows. One row per entity per edition. Movement columns compare to previous edition (the one being superseded). Composite dimension columns are populated only for composite-type ranking lists.';
COMMENT ON COLUMN ranking_entries.score IS 'For composite lists this is the outer composite score (editorial * 0.70 + sites * 0.30 in Phase 1). For raw_stat lists this is the underlying stat value (e.g., 5 for goals in Top Scorers).';
COMMENT ON COLUMN ranking_entries.editorial_composite IS 'The 5-dimension editorial composite, before sites layer is mixed in. NULL for raw_stat lists. Reconstructable from the 5 dimension columns (result/process/squad/coherence/momentum for teams).';
