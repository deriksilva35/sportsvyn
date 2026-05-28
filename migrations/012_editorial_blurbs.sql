-- ============================================================================
-- Migration 012 — Editorial Blurbs (AI-generated entity-attached prose)
-- ============================================================================
-- Purpose: Small AI-generated paragraphs that attach to entities or ranking
--          rows. Distinct from full articles (which use the articles table).
--          Versioned, editor-reviewable, with auto-publish fallback.
-- Powers:  - Sportsvyn Outlook section on Team page (2-paragraph blurb)
--          - Sportsvyn Outlook section on Player page
--          - Ranking-row blurbs in /rankings deep-dives (1-sentence to 1-paragraph)
--          - Stats Hub category editorial framing (intro paragraph per category)
-- ============================================================================

CREATE TABLE editorial_blurbs (
  id                    serial PRIMARY KEY,

  -- Type discriminator
  blurb_type            text NOT NULL CHECK (blurb_type IN (
    'team_outlook',                 -- 2-para on Team page (between Hero and Form strip)
    'player_outlook',               -- 2-para on Player page (between Hero and Form strip)
    'ranking_row_blurb',            -- 1-sentence to 1-para per ranking entry
    'stats_framing'                 -- intro on Stats Hub category pages
  )),

  -- Polymorphic entity reference (exactly one non-null per blurb_type)
  team_id               integer REFERENCES teams(id) ON DELETE CASCADE,
  player_id             integer REFERENCES players(id) ON DELETE CASCADE,
  ranking_entry_id      integer REFERENCES ranking_entries(id) ON DELETE CASCADE,
  league_id             integer REFERENCES leagues(id) ON DELETE CASCADE,

  -- Content
  body                  text NOT NULL,
  word_count            integer GENERATED ALWAYS AS (array_length(string_to_array(body, ' '), 1)) STORED,
  voice_model_version   text NOT NULL DEFAULT '1.0',

  -- AI pipeline metadata
  generated_at          timestamptz NOT NULL DEFAULT now(),
  generation_tier       text NOT NULL DEFAULT 'tier_2_draft' CHECK (generation_tier IN ('tier_1_brief', 'tier_2_draft', 'manual')),
  prompt_template_id    integer,                          -- FK added in migration 016
  generation_input      jsonb,                            -- snapshot of data fed to the prompt

  -- Editorial review
  status                text NOT NULL DEFAULT 'pending_review' CHECK (status IN (
    'pending_review',
    'editor_approved',
    'auto_published',                                     -- via 24h fallback per AI Writer Pipeline spec
    'rejected',
    'superseded'
  )),
  reviewed_at           timestamptz,
  reviewed_by           text,
  editor_notes          text,

  -- Publishing state
  published_at          timestamptz,
  is_current            boolean NOT NULL DEFAULT false,
  auto_published        boolean NOT NULL DEFAULT false,   -- true = 24h fallback, NOT editor-approved

  -- Versioning chain
  supersedes_id         integer REFERENCES editorial_blurbs(id) ON DELETE SET NULL,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Exactly one entity reference
  CHECK (
    (CASE WHEN team_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN player_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN ranking_entry_id IS NOT NULL THEN 1 ELSE 0 END +
     CASE WHEN league_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);

CREATE INDEX idx_editorial_blurbs_team_current ON editorial_blurbs(team_id) WHERE team_id IS NOT NULL AND is_current = true;
CREATE INDEX idx_editorial_blurbs_player_current ON editorial_blurbs(player_id) WHERE player_id IS NOT NULL AND is_current = true;
CREATE INDEX idx_editorial_blurbs_ranking_entry ON editorial_blurbs(ranking_entry_id) WHERE ranking_entry_id IS NOT NULL;
CREATE INDEX idx_editorial_blurbs_pending ON editorial_blurbs(status, generated_at DESC) WHERE status = 'pending_review';
CREATE INDEX idx_editorial_blurbs_type_current ON editorial_blurbs(blurb_type, is_current) WHERE is_current = true;

-- Ensure only one current blurb per entity per type
CREATE UNIQUE INDEX idx_editorial_blurbs_team_one_current
  ON editorial_blurbs(team_id, blurb_type)
  WHERE team_id IS NOT NULL AND is_current = true;
CREATE UNIQUE INDEX idx_editorial_blurbs_player_one_current
  ON editorial_blurbs(player_id, blurb_type)
  WHERE player_id IS NOT NULL AND is_current = true;
CREATE UNIQUE INDEX idx_editorial_blurbs_ranking_one_current
  ON editorial_blurbs(ranking_entry_id, blurb_type)
  WHERE ranking_entry_id IS NOT NULL AND is_current = true;

COMMENT ON TABLE editorial_blurbs IS 'AI-generated entity-attached prose. Distinct from articles (full editorial pieces). Each blurb has lifecycle: generated → pending_review → (editor_approved OR auto_published after 24h fallback OR rejected) → published. Versioned via supersedes_id chain. Per AI Writer Pipeline spec May 27 2026.';
COMMENT ON COLUMN editorial_blurbs.auto_published IS 'TRUE = this blurb went live via the 24h editor-review-timeout fallback. The Team/Player page renders the "Auto-generated · Updated [N]h ago" badge based on this column. Auto-published blurbs are still subject to retroactive editor review.';
COMMENT ON COLUMN editorial_blurbs.voice_model_version IS 'Tracks which Voice Bible version this blurb was generated under. Surfaced in the byline ("v1.0 voice model"). When the Voice Bible bumps, all current blurbs are flagged for regeneration.';

-- Cross-reference: ranking_entries.blurb_id → editorial_blurbs
ALTER TABLE ranking_entries
  ADD CONSTRAINT fk_ranking_entries_blurb
  FOREIGN KEY (blurb_id) REFERENCES editorial_blurbs(id) ON DELETE SET NULL;
