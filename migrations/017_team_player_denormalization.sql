-- ============================================================================
-- Migration 017 — Team & Player Denormalization
-- ============================================================================
-- Purpose: Add denormalized "current" columns to teams and players for fast
--          page loads. The Team and Player pages render heavy hero blocks with
--          current rank + composite + outlook blurb + photo. Joining
--          ranking_entries + editorial_blurbs + player_tournament_stats on
--          every page request would be expensive; instead we denormalize the
--          "current" pointers and refresh on edition publish.
-- Powers:  - Team page Hero (Power Ranking block, meta, photo treatment)
--          - Player page Hero (Player Composite block, bio meta, photo)
--          - Top Players card grid on Team page
--          - Player tile rows in Stats Hub
-- ============================================================================

-- Add denormalized columns to teams
ALTER TABLE teams
  ADD COLUMN current_power_rank        integer,
  ADD COLUMN current_power_score       numeric(4,2),
  ADD COLUMN current_rank_movement     integer,
  ADD COLUMN current_outlook_blurb_id  integer REFERENCES editorial_blurbs(id) ON DELETE SET NULL,
  ADD COLUMN confederation             text,
  ADD COLUMN coach_name                text,
  ADD COLUMN fifa_rank                 integer,
  ADD COLUMN group_code                text,
  ADD COLUMN tournament_wins           integer NOT NULL DEFAULT 0,
  ADD COLUMN tournament_draws          integer NOT NULL DEFAULT 0,
  ADD COLUMN tournament_losses         integer NOT NULL DEFAULT 0,
  ADD COLUMN tournament_goals_for      integer NOT NULL DEFAULT 0,
  ADD COLUMN tournament_goals_against  integer NOT NULL DEFAULT 0,
  ADD COLUMN flag_svg_path             text,                            -- Vercel Blob URL for SVG flag
  ADD COLUMN flag_color_primary        text;                            -- For team-color accents in dark UI

CREATE INDEX idx_teams_power_rank ON teams(league_id, current_power_rank) WHERE current_power_rank IS NOT NULL;

COMMENT ON COLUMN teams.current_power_rank IS 'Denormalized from ranking_entries → ranking_editions WHERE is_current=true AND ranking_list_id=team-power. Refreshed by a publish_ranking_edition() function whenever an edition flips to current. Powers Team page Hero block.';
COMMENT ON COLUMN teams.current_outlook_blurb_id IS 'Denormalized FK to the current Team Outlook blurb. Refreshed when a blurb flips to is_current=true. Powers the Sportsvyn Outlook section on Team page.';
COMMENT ON COLUMN teams.tournament_wins IS 'Denormalized W-D-L record across matches in the current league. Refreshed on match FT alongside team_tournament_stats. Powers the WC Record meta row in Team Hero.';


-- Add denormalized columns to players
ALTER TABLE players
  ADD COLUMN current_composite_rank      integer,
  ADD COLUMN current_composite_score     numeric(4,2),
  ADD COLUMN current_rank_movement       integer,
  ADD COLUMN current_outlook_blurb_id    integer REFERENCES editorial_blurbs(id) ON DELETE SET NULL,
  ADD COLUMN current_team_jersey_number  integer,
  ADD COLUMN height_cm                   integer,
  ADD COLUMN preferred_foot              text CHECK (preferred_foot IN ('left', 'right', 'both', NULL)),
  ADD COLUMN club_name                   text,
  ADD COLUMN international_caps          integer,
  ADD COLUMN international_goals         integer,
  ADD COLUMN photo_url_source            text,                          -- raw URL from API-Sports
  ADD COLUMN photo_url_treated           text,                          -- duotone-processed cached version
  ADD COLUMN photo_treatment_recipe      text NOT NULL DEFAULT 'duotone-v1', -- grayscale(0.4) contrast(1.15) brightness(0.9)
  ADD COLUMN photo_synced_at             timestamptz,
  ADD COLUMN tournament_goals            integer NOT NULL DEFAULT 0,
  ADD COLUMN tournament_assists          integer NOT NULL DEFAULT 0;

CREATE INDEX idx_players_composite_rank ON players(current_composite_rank) WHERE current_composite_rank IS NOT NULL;
CREATE INDEX idx_players_team_jersey ON players(current_team_id, current_team_jersey_number) WHERE current_team_jersey_number IS NOT NULL;

COMMENT ON COLUMN players.photo_url_source IS 'Raw photo URL from API-Sports player payload. Refetched quarterly. NULL when the data provider lacks a photo (SVG silhouette fallback renders).';
COMMENT ON COLUMN players.photo_url_treated IS 'Duotone-processed cached version stored on Vercel Blob. Generated on first access via lib/photoGrade.js, refreshed when photo_url_source changes. Recipe spec May 27 2026: CSS filter grayscale(0.4) contrast(1.15) brightness(0.9) baked into the asset.';
COMMENT ON COLUMN players.preferred_foot IS 'Bio meta surfaced in Player Hero bio grid. NULL when unknown.';
COMMENT ON COLUMN players.international_caps IS 'Career international appearances. The Player Hero shows this alongside a sub-stat for tournament-specific appearances (e.g., "191 · tournament: 5").';
