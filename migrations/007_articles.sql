-- ============================================================================
-- Migration 007 — Articles
-- ============================================================================
-- Purpose: The single editorial table (locked decision #2 — one table with a
--          `type` discriminator, not polymorphic per-type tables). Carries the
--          two-zone body (The Take / The Conversation), a single composite
--          column, and all 15 dimension score columns across the three scoring
--          systems (locked decision #1 — wide columns, not JSON).
-- Powers:  - every editorial surface: recaps, previews (Watch Score), profiles
--            (Player Composite), rankings prose, edges, essays, newsletters
--          - article_id linkage on article_tags (008)
-- Depends: 003_leagues, 004_teams, 005_players, 006_matches
--
-- Scoring systems (all equal-weight flat mean of 5 dims; see Methodology v1.0):
--   score_type = 'watch'         → STAKES / QUALITY / NARRATIVE / DRAMA / MOMENT
--   score_type = 'power_ranking' → RESULT / PROCESS / SQUAD / COHERENCE / MOMENTUM
--   score_type = 'player'        → OUTPUT / EFFICIENCY / IMPACT / AVAILABILITY / CONTEXT
-- Only the five columns matching score_type are populated for a given row.
-- ============================================================================

CREATE TABLE articles (
  id                  serial PRIMARY KEY,

  slug                text NOT NULL UNIQUE,
  type                text NOT NULL
                        CHECK (type IN ('recap', 'preview', 'profile', 'rankings',
                                        'edge', 'essay', 'newsletter')),

  title               text NOT NULL,
  subtitle            text,

  -- Body: two-zone for long-form (profile/essay); single body for the rest
  body_take           text,                              -- "The Take" zone (Markdown)
  body_conversation   text,                              -- "The Conversation" zone (Markdown)
  body                text,                              -- non-two-zone pieces (newsletter, edge, etc.)

  hero_image_path     text,                              -- Vercel Blob URL (locked decision #6)
  hero_caption        text,

  -- Which composite (if any) this piece carries
  score_type          text CHECK (score_type IN ('watch', 'power_ranking', 'player', NULL)),

  -- Watch Score dimensions
  stakes_score        numeric(3,1),
  quality_score       numeric(3,1),
  narrative_score     numeric(3,1),
  drama_score         numeric(3,1),
  moment_score        numeric(3,1),

  -- Power Rankings dimensions
  result_score        numeric(3,1),
  process_score       numeric(3,1),
  squad_score         numeric(3,1),
  coherence_score     numeric(3,1),
  momentum_score      numeric(3,1),

  -- Player Composite dimensions
  output_score        numeric(3,1),
  efficiency_score    numeric(3,1),
  impact_score        numeric(3,1),
  availability_score  numeric(3,1),
  context_score       numeric(3,1),

  -- Stored composite (computed server-side at write time; flat mean of the 5
  -- dimensions matching score_type)
  composite_score     numeric(3,1),

  -- Linkage
  league_id           integer REFERENCES leagues(id) ON DELETE SET NULL,
  match_id            integer REFERENCES matches(id) ON DELETE SET NULL,
  team_ids            integer[] NOT NULL DEFAULT '{}',   -- multi-team linkage (arrays can't FK in PG)
  player_ids          integer[] NOT NULL DEFAULT '{}',   -- multi-player linkage

  -- Publishing state
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'preview', 'published', 'unpublished')),
  published_at        timestamptz,

  author              text,                              -- 'Derik Silva' until a users table exists

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_articles_status_published ON articles(status, published_at DESC);
CREATE INDEX idx_articles_type ON articles(type);
CREATE INDEX idx_articles_league ON articles(league_id);
CREATE INDEX idx_articles_match ON articles(match_id) WHERE match_id IS NOT NULL;
CREATE INDEX idx_articles_team_ids ON articles USING gin (team_ids);
CREATE INDEX idx_articles_player_ids ON articles USING gin (player_ids);

COMMENT ON TABLE articles IS 'Single editorial table with a type discriminator (locked #2). 15 wide dimension columns across the three composite systems (locked #1); only the five matching score_type are populated per row. team_ids/player_ids are integer arrays (GIN-indexed) for multi-entity linkage.';
COMMENT ON COLUMN articles.score_type IS 'watch | power_ranking | player | NULL. Determines which 5 dimension columns are meaningful for this row.';
COMMENT ON COLUMN articles.composite_score IS '0.0-10.0 flat mean of the 5 dimensions matching score_type. Computed server-side; never trusted from the client. voiceLint blocks publish if it disagrees with the dimension average.';
COMMENT ON COLUMN articles.team_ids IS 'Array of teams(id). Not FK-enforced (PG limitation). Cleaned up by application logic, not cascade.';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT type, score_type, status, COUNT(*) FROM articles GROUP BY 1,2,3;
--   -- Expect 0 rows initially.
-- ----------------------------------------------------------------------------
