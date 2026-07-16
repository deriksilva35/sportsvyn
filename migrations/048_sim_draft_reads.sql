-- ============================================================================
-- Migration 048 — draft_reads (THE READ: grade + AI prose per completed draft)
-- ============================================================================
-- One row per draft (draft_id UNIQUE) holding the graded Read: the letter grade
-- + numeric score, the full computed component breakdown (jsonb, for the
-- transparency table + /methodology), and the prose (AI or deterministic
-- fallback). Generated ONCE on results view and read thereafter (never
-- regenerated on view). CASCADE with the draft.
--
-- prose_source is 'ai' when the Anthropic call passed all validators, 'fallback'
-- when the deterministic callout-assembled prose was used instead.
-- Depends: 046 (drafts). Additive; reversible by DROP TABLE.
-- ============================================================================

CREATE TABLE draft_reads (
  id            serial PRIMARY KEY,
  draft_id      integer     NOT NULL UNIQUE REFERENCES drafts(id) ON DELETE CASCADE,
  grade         text,
  grade_score   numeric,
  components    jsonb,
  prose         text,
  prose_source  text        CHECK (prose_source IN ('ai', 'fallback')),
  model         text,
  generated_at  timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT to_regclass('public.draft_reads');            -- not null
--   SELECT count(*) FROM draft_reads;                    -- 0 pre-generation
--   \d draft_reads  -- draft_id UNIQUE + FK cascade, prose_source CHECK
-- ----------------------------------------------------------------------------
