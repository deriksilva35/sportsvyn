-- Migration 019 — match_briefs
-- ============================================================================
-- Storage for Tier 1 Brief output. Distinct from ai_generations (which is the
-- per-API-call provenance log) and from editorial_blurbs (which holds
-- entity-attached prose like team outlooks). One row per generated brief.
--
-- raw_response holds the original Anthropic message payload verbatim so we
-- can replay/inspect the model's output independent of the parsed
-- headline/paragraph fields — same provenance pattern as ai_generations
-- but scoped to this single artifact type.
--
-- validation_status records which path produced the row: 'passed' = a
-- gated model response, 'fallback' = the deterministic template after
-- two failed attempts. The render layer MUST surface a badge that
-- differentiates these two states (per spec, validation gate #5).
-- ============================================================================

CREATE TABLE match_briefs (
  id                 serial PRIMARY KEY,
  match_id           integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  kind               text NOT NULL DEFAULT 'auto' CHECK (kind IN ('auto', 'manual')),

  headline           text NOT NULL,
  paragraph_1        text NOT NULL,
  paragraph_2        text NOT NULL,
  paragraph_3        text,

  model              text NOT NULL,
  raw_response       jsonb,

  validation_status  text NOT NULL CHECK (validation_status IN ('passed', 'fallback')),

  generated_at       timestamptz NOT NULL DEFAULT now(),
  published_at       timestamptz
);

CREATE INDEX idx_match_briefs_match ON match_briefs(match_id, generated_at DESC);
CREATE INDEX idx_match_briefs_fallback ON match_briefs(generated_at DESC) WHERE validation_status = 'fallback';

COMMENT ON TABLE match_briefs IS 'Tier 1 Brief output per the AI Writer Pipeline spec. One row per generation attempt that produced renderable output (whether from the model after gating or from the deterministic templated fallback).';
COMMENT ON COLUMN match_briefs.raw_response IS 'Verbatim Anthropic API response (the message object). NULL on fallback rows where no usable model output exists.';
COMMENT ON COLUMN match_briefs.validation_status IS 'passed = model output cleared all five validation gates. fallback = deterministic templated text used because the model failed twice or its output never cleared gating. The render layer surfaces a "Templated · accuracy-first" badge for fallback rows.';
