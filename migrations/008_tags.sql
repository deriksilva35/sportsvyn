-- ============================================================================
-- Migration 008 — Tags + Article Tags
-- ============================================================================
-- Purpose: Tag infrastructure (locked decision #4 — build the tags table +
--          article_tags join now; deploy lightly during the WC, lean in for
--          NFL/CFB). Migration 015 later enriches this table with the 4-way
--          category, current-state config, entity references, and following.
-- Powers:  - related-articles surface on article pages (WC)
--          - /tag/[slug] landing pages (baseline; 015 completes the template)
-- Depends: 003_leagues, 007_articles
-- IMPORTANT: `tag_type` MUST exist here. Migration 015 backfills its new
--            `tag_category` column FROM tag_type:
--              tag_type IN ('theme','editorial') -> 'theme'
--              tag_type IN ('list','series')     -> 'storyline'
--            Removing or renaming tag_type would break 015's UPDATE.
--            Do NOT add 015's columns (tag_category, current_state_config,
--            entity_type, team_id, player_id, follower_count, article_count,
--            last_article_published_at, scope_label) here.
-- ============================================================================

CREATE TABLE tags (
  id                  serial PRIMARY KEY,

  slug                text NOT NULL UNIQUE,              -- 'golden-boot-race', 'group-of-death'
  name                text NOT NULL,                     -- 'Golden Boot Race'

  -- Legacy tag classifier. 015 derives the richer tag_category from this.
  tag_type            text NOT NULL DEFAULT 'theme'
                        CHECK (tag_type IN ('theme', 'list', 'series', 'editorial')),

  description         text,
  hero_image_path     text,                              -- Vercel Blob URL; optional in WC
  is_featured         boolean NOT NULL DEFAULT false,    -- surfaces in homepage tag rail (NFL/CFB)

  league_id           integer REFERENCES leagues(id) ON DELETE SET NULL,  -- nullable; some tags cross leagues

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tags_type ON tags(tag_type);
CREATE INDEX idx_tags_featured ON tags(is_featured) WHERE is_featured = true;
CREATE INDEX idx_tags_league ON tags(league_id) WHERE league_id IS NOT NULL;

COMMENT ON TABLE tags IS 'Tag baseline (locked #4). 015 enriches with 4-way category, current-state config, entity refs, and follow counts. tag_type is the legacy classifier 015 backfills tag_category from — do not remove.';
COMMENT ON COLUMN tags.tag_type IS 'Legacy classifier: theme | list | series | editorial. 015 maps these into the new tag_category (entity/storyline/stage/theme).';


-- Join table: many-to-many articles <-> tags
CREATE TABLE article_tags (
  article_id          integer NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id              integer NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (article_id, tag_id)
);

CREATE INDEX idx_article_tags_tag ON article_tags(tag_id);

COMMENT ON TABLE article_tags IS 'Many-to-many join between articles and tags. Composite PK (article_id, tag_id) prevents duplicate links; both sides cascade on delete.';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT slug, name, tag_type, is_featured FROM tags ORDER BY id;
--   SELECT COUNT(*) FROM article_tags;
--   -- Expect 0 rows initially.
--   -- Confirm tag_type column exists (015 depends on it):
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'tags' AND column_name = 'tag_type';
--   -- Expect exactly 1 row.
-- ----------------------------------------------------------------------------
