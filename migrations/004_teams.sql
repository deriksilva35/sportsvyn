-- ============================================================================
-- Migration 004 — Teams
-- ============================================================================
-- Purpose: League-scoped teams. Slugs are unique PER LEAGUE (so an NFL team
--          and a college team can share a short slug without collision).
-- Powers:  - /team/[slug] pages
--          - home/away references on matches
--          - team scoping on stats, rankings, articles, tags
-- Depends: 003_leagues
-- NOTE:    The WC-specific and denormalized columns (confederation, coach_name,
--          fifa_rank, group_code, current_power_rank, flag_*, tournament_*)
--          are intentionally NOT created here. Migration 017 adds them. Adding
--          them here would make 017's ALTER ... ADD COLUMN fail.
-- ============================================================================

CREATE TABLE teams (
  id                       serial PRIMARY KEY,

  league_id                integer NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,

  slug                     text NOT NULL,                 -- 'argentina', 'philadelphia-eagles', 'alabama'
  name                     text NOT NULL,                 -- 'Argentina', 'Philadelphia Eagles'
  short_name               text,                          -- 'Argentina', 'Eagles'
  abbreviation             text,                          -- 'ARG', 'PHI', 'ALA'

  -- Provider linkage + freshness
  external_ids             jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_provider_synced_at  timestamptz,

  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,  -- city, founded, stadium, etc.

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (league_id, slug)
);

CREATE INDEX idx_teams_league ON teams(league_id);

COMMENT ON TABLE teams IS 'League-scoped teams. Slug is unique within a league, not globally. Denormalized rank/photo/bio columns are added later in 017.';
COMMENT ON CONSTRAINT teams_league_id_slug_key ON teams IS 'Per-league slug uniqueness: (league_id, slug). Allows slug reuse across leagues.';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT t.slug, t.name, l.slug AS league
--     FROM teams t JOIN leagues l ON l.id = t.league_id ORDER BY t.id;
--   -- Expect 0 rows initially.
-- ----------------------------------------------------------------------------
