-- ============================================================================
-- Migration 006 — Matches
-- ============================================================================
-- Purpose: Matches/games. Includes the tournament bracket fields `stage` and
--          `group_code` (locked decision #3) so the WC group stage + knockout
--          bracket are representable without a separate bracket table.
-- Powers:  - /match/[slug] pages (pre-match Watch Score, live, recap)
--          - match_id linkage on player_match_stats (010), broadcasters (013),
--            odds_markets (014), and articles (007)
-- Depends: 003_leagues, 004_teams
-- ============================================================================

CREATE TABLE matches (
  id                       serial PRIMARY KEY,

  league_id                integer NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  slug                     text NOT NULL UNIQUE,          -- 'usa-vs-mexico-2026-06-15'

  home_team_id             integer REFERENCES teams(id) ON DELETE SET NULL,
  away_team_id             integer REFERENCES teams(id) ON DELETE SET NULL,

  kickoff_at               timestamptz NOT NULL,
  status                   text NOT NULL DEFAULT 'scheduled'
                             CHECK (status IN ('scheduled', 'live', 'final', 'postponed', 'cancelled')),

  home_score               integer,
  away_score               integer,

  -- Tournament structure (locked decision #3)
  stage                    text,                          -- 'group', 'round_of_32', 'round_of_16', 'quarter', 'semi', 'third_place', 'final'
  group_code               text,                          -- 'A'..'L' for WC group stage; NULL in knockouts and non-group leagues

  venue                    text,

  -- Provider linkage + freshness
  external_ids             jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_provider_synced_at  timestamptz,

  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,  -- attendance, weather, referee, etc.

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_matches_league_kickoff ON matches(league_id, kickoff_at);
CREATE INDEX idx_matches_status ON matches(status) WHERE status <> 'final';
CREATE INDEX idx_matches_stage ON matches(league_id, stage) WHERE stage IS NOT NULL;
CREATE INDEX idx_matches_group ON matches(league_id, group_code) WHERE group_code IS NOT NULL;

COMMENT ON TABLE matches IS 'Matches/games. stage + group_code carry the tournament bracket inline (locked decision #3) so the WC group + knockout structure needs no separate bracket table.';
COMMENT ON COLUMN matches.stage IS 'group | round_of_32 | round_of_16 | quarter | semi | third_place | final. NULL for non-tournament league matches.';
COMMENT ON COLUMN matches.group_code IS 'Group letter (A..L) during group stage. NULL in knockouts and in non-group competitions.';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT m.slug, m.stage, m.group_code, m.status,
--          h.short_name AS home, a.short_name AS away
--     FROM matches m
--     LEFT JOIN teams h ON h.id = m.home_team_id
--     LEFT JOIN teams a ON a.id = m.away_team_id
--    ORDER BY m.kickoff_at;
--   -- Expect 0 rows initially.
-- ----------------------------------------------------------------------------
