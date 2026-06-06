-- ============================================================================
-- Migration 028 — articles.moment_basis + articles.edited_at
-- ============================================================================
-- Two adds for the pre-match analyst pass auto-publish + edit-freeze model:
--
--   moment_basis text — declared by the AI alongside its MOMENT score, the
--                       publish-decision tripwire. Enum values: 'sporting',
--                       'cultural', 'geopolitical'. NULL on rows that
--                       aren't analyst-generated (every other article type).
--                       'geopolitical' routes the article to admin review
--                       before render; the other two auto-publish.
--
--   edited_at timestamptz — set when an admin saves an edit through the
--                       /admin/prematch surface. The runner's freeze logic
--                       refuses to overwrite ANY row that exists, but the
--                       edited_at marker lets the UI render the "edited"
--                       provenance cleanly and audit later. NULL means
--                       the row is still the original AI output.
--
-- Both columns are nullable + safe to add to existing rows. ADD COLUMN
-- with no default is instant on Postgres 11+. No backfill needed.
--
-- The articles table extends to: existing dim/note/composite columns
-- (007, 020) + moment_basis + edited_at + the existing status column
-- ('draft' / 'preview' / 'published' / 'unpublished'). The auto-publish
-- model uses 'preview' for pending_review (the runner sets it on
-- geopolitical) and 'published' for the auto-shipped majority.
-- ============================================================================

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS moment_basis text,
  ADD COLUMN IF NOT EXISTS edited_at    timestamptz;

ALTER TABLE articles
  DROP CONSTRAINT IF EXISTS articles_moment_basis_check;
ALTER TABLE articles
  ADD CONSTRAINT articles_moment_basis_check
    CHECK (moment_basis IS NULL OR moment_basis IN ('sporting', 'cultural', 'geopolitical'));

COMMENT ON COLUMN articles.moment_basis IS
  'For score_type=''watch'' rows: the AI''s declared kind of resonance driving the MOMENT score (sporting | cultural | geopolitical). The pre-match analyst runner routes ''geopolitical'' to admin review (status=''preview''); other values auto-publish (status=''published'').';

COMMENT ON COLUMN articles.edited_at IS
  'Timestamp of last admin edit through /admin/prematch. NULL means the row is the original AI output. The analyst runner''s freeze logic refuses to overwrite ANY existing row (idempotent on the natural-key (match_id, type, score_type)); edited_at exists for the UI to render edit-provenance and for audit.';
