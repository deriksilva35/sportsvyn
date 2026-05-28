-- ============================================================================
-- Migration 005 — Players
-- ============================================================================
-- Purpose: Players. Slugs are GLOBAL-unique (a player has one canonical page
--          even if they change teams). current_team_id links to the roster
--          they currently belong to.
-- Powers:  - /player/[slug] pages
--          - player scoping on stats, rankings, articles, tags
-- Depends: 004_teams
-- NOTE:    The denormalized + bio + photo columns (current_composite_rank,
--          current_team_jersey_number, height_cm, preferred_foot, club_name,
--          international_caps/goals, photo_url_*, tournament_goals/assists)
--          are NOT created here. Migration 017 adds them. current_team_id IS
--          created here because 017 builds an index on it.
-- ============================================================================

CREATE TABLE players (
  id                       serial PRIMARY KEY,

  slug                     text NOT NULL UNIQUE,          -- 'lionel-messi', 'joe-burrow'
  full_name                text NOT NULL,                 -- 'Lionel Messi'
  known_as                 text,                          -- 'Messi' (display short form)
  position                 text,                          -- 'CF', 'QB', 'GK'
  nationality              text,                          -- 'Argentina' (string; not an FK)

  current_team_id          integer REFERENCES teams(id) ON DELETE SET NULL,
  birthdate                date,

  -- Provider linkage + freshness
  external_ids             jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_provider_synced_at  timestamptz,

  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,  -- weight, dominant_foot draft data, etc.

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_players_current_team ON players(current_team_id);
CREATE INDEX idx_players_position ON players(position);

COMMENT ON TABLE players IS 'Global-unique player slugs. Bio, photo, and denormalized rank columns added later in 017. current_team_id is created here so 017 can index (current_team_id, current_team_jersey_number).';
COMMENT ON COLUMN players.current_team_id IS 'Nullable. SET NULL on team delete. A player without a current team (free agent / retired) is valid.';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT p.slug, p.full_name, t.slug AS team
--     FROM players p LEFT JOIN teams t ON t.id = p.current_team_id ORDER BY p.id;
--   -- Expect 0 rows initially.
-- ----------------------------------------------------------------------------
