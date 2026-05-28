-- ============================================================================
-- Migration 015 — Tag Enhancements (4-way category + current state + following)
-- ============================================================================
-- Purpose: Refine the existing tags table to support the Tag landing page
--          template locked May 27 2026. Add the 4-way category discriminator
--          (entity/storyline/stage/theme), current_state config for data-
--          attached tags, entity references for entity-type tags, and the
--          tag_follows table for Phase 2 personalization.
-- Powers:  - Tag landing page (/tag/[slug]) Type Badge in hero
--          - Current State data block (mini leaderboard/data view)
--          - Follow tag CTA (Phase 2 personalization → Daily Card)
-- ============================================================================

-- Add new columns to existing tags table (008_tags.sql baseline)
ALTER TABLE tags
  ADD COLUMN tag_category text,                                   -- 'entity' | 'storyline' | 'stage' | 'theme'
  ADD COLUMN current_state_config jsonb,                          -- config for the Current State data block
  ADD COLUMN entity_type text CHECK (entity_type IN ('team', 'player', NULL)),
  ADD COLUMN team_id integer REFERENCES teams(id) ON DELETE SET NULL,
  ADD COLUMN player_id integer REFERENCES players(id) ON DELETE SET NULL,
  ADD COLUMN follower_count integer NOT NULL DEFAULT 0,
  ADD COLUMN article_count integer NOT NULL DEFAULT 0,            -- denormalized count for fast hub queries
  ADD COLUMN last_article_published_at timestamptz,
  ADD COLUMN scope_label text;                                    -- 'Tournament-long' | 'Round-specific' | 'Evergreen' | etc.

-- Backfill tag_category from legacy tag_type values
-- Legacy tag_type values: 'theme' | 'list' | 'series' | 'editorial'
UPDATE tags SET tag_category = CASE
  WHEN tag_type IN ('theme', 'editorial') THEN 'theme'
  WHEN tag_type IN ('list', 'series') THEN 'storyline'
  ELSE 'theme'
END
WHERE tag_category IS NULL;

-- Now lock in the not-null + default
ALTER TABLE tags ALTER COLUMN tag_category SET DEFAULT 'theme';
ALTER TABLE tags ALTER COLUMN tag_category SET NOT NULL;
ALTER TABLE tags ADD CONSTRAINT chk_tag_category CHECK (tag_category IN ('entity', 'storyline', 'stage', 'theme'));

-- Entity-type tags must have exactly one entity reference
ALTER TABLE tags ADD CONSTRAINT chk_tags_entity_reference CHECK (
  tag_category != 'entity' OR
  (entity_type = 'team' AND team_id IS NOT NULL AND player_id IS NULL) OR
  (entity_type = 'player' AND player_id IS NOT NULL AND team_id IS NULL)
);

CREATE INDEX idx_tags_category ON tags(tag_category);
CREATE INDEX idx_tags_entity_team ON tags(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX idx_tags_entity_player ON tags(player_id) WHERE player_id IS NOT NULL;
CREATE INDEX idx_tags_followers ON tags(follower_count DESC) WHERE follower_count > 0;
CREATE INDEX idx_tags_article_count ON tags(article_count DESC) WHERE article_count > 0;

COMMENT ON COLUMN tags.tag_category IS 'Four-way classification from May 27 2026 Tag landing design: entity (Player/Team-linked — tag IS that entity), storyline (tournament-long narrative — Golden Boot Race, Scaloni System), stage (temporal/structural — R32, Group Stage, Quarterfinal), theme (editorial pattern — Upsets, Tactical Shifts, Young Stars).';
COMMENT ON COLUMN tags.current_state_config IS 'JSON config for the optional Current State data block on /tag/[slug]. Example: {"type":"leaderboard","source":"ranking_list:top-scorers","limit":5} renders the Top 5 Scorers mini-leaderboard with movement chips. NULL = no Current State block rendered (pure editorial tag).';
COMMENT ON COLUMN tags.follower_count IS 'Denormalized count for sort/display. Source of truth is tag_follows table. Updated by trigger or batch job.';
COMMENT ON COLUMN tags.article_count IS 'Denormalized count of published articles tagged with this tag. Refreshed via batch job or article_tags trigger.';


-- Tag follows table (Phase 2 personalization, schema-ready now)
CREATE TABLE tag_follows (
  user_id       integer NOT NULL,                                 -- FK added in Phase 2 reader layer (users table)
  tag_id        integer NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  followed_at   timestamptz NOT NULL DEFAULT now(),
  notification_pref text NOT NULL DEFAULT 'digest' CHECK (notification_pref IN ('none', 'digest', 'immediate')),
  PRIMARY KEY (user_id, tag_id)
);

CREATE INDEX idx_tag_follows_user ON tag_follows(user_id);
CREATE INDEX idx_tag_follows_tag ON tag_follows(tag_id);

COMMENT ON TABLE tag_follows IS 'Tag following for personalized Daily Card content. Phase 2 feature; schema ready in Phase 1. user_id FK is loose now (no users table yet); will be tightened when reader layer ships.';


-- Backfill: create entity tags for every team and player (one each)
-- These tags will power entity tag landing pages (e.g., /tag/messi alongside /player/lionel-messi)
INSERT INTO tags (slug, name, tag_type, tag_category, entity_type, team_id, league_id, description)
SELECT
  'team-' || t.slug,
  t.name,
  'theme',                                                        -- legacy column; ignored going forward
  'entity',
  'team',
  t.id,
  t.league_id,
  'Entity tag for ' || t.name || '. Aggregates all articles featuring this team.'
FROM teams t
ON CONFLICT (slug) DO NOTHING;

INSERT INTO tags (slug, name, tag_type, tag_category, entity_type, player_id, description)
SELECT
  p.slug,
  p.full_name,
  'theme',                                                        -- legacy column
  'entity',
  'player',
  p.id,
  'Entity tag for ' || p.full_name || '. Aggregates all articles featuring this player.'
FROM players p
ON CONFLICT (slug) DO NOTHING;
