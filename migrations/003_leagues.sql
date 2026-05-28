-- ============================================================================
-- Migration 003 — Leagues
-- ============================================================================
-- Purpose: Root reference table. A "league" is any competition Sportsvyn
--          covers: the 2026 World Cup, the NFL, College Football, etc.
--          Every team, match, ranking, and most articles hang off a league.
-- Powers:  - /league/[slug] overview pages
--          - league scoping for teams, matches, rankings, stats, tags
-- Depends: (none — this is the root of the sports schema)
-- ============================================================================

CREATE TABLE leagues (
  id                       serial PRIMARY KEY,

  slug                     text NOT NULL UNIQUE,          -- 'fifa-wc-2026', 'nfl', 'cfb'
  name                     text NOT NULL,                 -- '2026 FIFA World Cup', 'NFL'
  short_name               text,                          -- 'World Cup', 'NFL'
  sport                    text NOT NULL,                 -- 'soccer', 'football', 'basketball'
  season_type              text,                          -- 'tournament', 'regular', 'season-and-postseason'
  season_year              integer,                       -- 2026

  -- Provider linkage + freshness (provider-agnostic; swap painless via keys)
  external_ids             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"api_sports": "1", "sports_data_io": "..."}
  data_provider_synced_at  timestamptz,

  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,  -- host countries, dates, format, etc.

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_leagues_sport ON leagues(sport);

COMMENT ON TABLE leagues IS 'Root reference table for every competition Sportsvyn covers. No separate tournaments table — a tournament (e.g., the 2026 World Cup) is a league row with season_type = ''tournament''.';
COMMENT ON COLUMN leagues.external_ids IS 'Provider id map. Keys added per provider so a provider swap (API-Sports for WC, SportsData.io for NFL) never requires a schema change.';
COMMENT ON COLUMN leagues.season_type IS 'tournament | regular | season-and-postseason';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT slug, name, sport, season_type FROM leagues ORDER BY id;
--   -- Expect 0 rows initially; seeded by application bootstrap.
-- ----------------------------------------------------------------------------
