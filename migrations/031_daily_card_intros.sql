-- ============================================================================
-- Migration 031 — daily_card_intros
-- ============================================================================
-- Purpose: One AI-generated Daily Card intro per PT day, gated by editor
--          review before publish (same generate→review→publish pattern as
--          articles/blurbs). Keyed by pt_day for idempotent UPSERT — a
--          re-generation on the same day overwrites the prior draft, never
--          duplicates.
-- Status:  pending_review (default after generation) → published (after
--          admin approve) or rejected (after admin reject).
-- ============================================================================

CREATE TABLE daily_card_intros (
  id            serial PRIMARY KEY,
  pt_day        date NOT NULL UNIQUE,                  -- one intro per PT day
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'pending_review'
                CHECK (status IN ('pending_review', 'published', 'rejected')),
  generated_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz,
  reviewed_by   text,
  published_at  timestamptz,
  model_meta    jsonb NOT NULL DEFAULT '{}'::jsonb,    -- model, usage, validation issues
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_daily_card_intros_status ON daily_card_intros(status, pt_day DESC);

COMMENT ON TABLE daily_card_intros IS 'AI-generated Daily Card intros, one per PT calendar day, editor-gated before publish. pt_day UNIQUE: re-generation upserts the existing day''s draft. The homepage reads status=published only; pending_review entries never surface publicly.';
COMMENT ON COLUMN daily_card_intros.model_meta IS 'Generator metadata: { model, usage, validation: { ok, issues } }. Persisted for audit + to surface validation flags in the review queue.';
