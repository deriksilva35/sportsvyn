-- Migration 020 — Watch Score per-dimension notes + summary
-- ============================================================================
-- Adds the 5 dimension-defense text columns and a summary column to the
-- articles table so a score_type='watch' row can carry the full Watch Score
-- payload:
--
--   already in migration 007:
--     - stakes_score / quality_score / narrative_score / drama_score /
--       moment_score   (numeric(3,1) per dimension)
--     - composite_score (numeric(3,1), server-computed flat mean — never
--                        trusted from the client/model)
--
--   added here:
--     - stakes_note / quality_note / narrative_note / drama_note /
--       moment_note   (one-sentence defenses, ≤25 words each)
--     - watch_summary (40-70 word overall verdict)
--
-- watch_summary is intentionally NOT named "summary" so it doesn't collide
-- with any future summary column intended for non-Watch article types
-- (recap, profile, essay, etc.).
--
-- The articles table currently has no JSONB column for storing the raw
-- model response. We're NOT adding one here — that gap is acknowledged
-- and can be addressed in a future migration if we need to replay or
-- audit specific model responses.
--
-- IF NOT EXISTS makes the migration idempotent.
-- ============================================================================

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS stakes_note     text,
  ADD COLUMN IF NOT EXISTS quality_note    text,
  ADD COLUMN IF NOT EXISTS narrative_note  text,
  ADD COLUMN IF NOT EXISTS drama_note      text,
  ADD COLUMN IF NOT EXISTS moment_note     text,
  ADD COLUMN IF NOT EXISTS watch_summary   text;

COMMENT ON COLUMN articles.stakes_note    IS 'Watch Score STAKES defense (one sentence, ≤25 words). Populated for score_type=''watch'' rows.';
COMMENT ON COLUMN articles.quality_note   IS 'Watch Score QUALITY defense (one sentence, ≤25 words). Populated for score_type=''watch'' rows.';
COMMENT ON COLUMN articles.narrative_note IS 'Watch Score NARRATIVE defense (one sentence, ≤25 words). Populated for score_type=''watch'' rows.';
COMMENT ON COLUMN articles.drama_note     IS 'Watch Score DRAMA defense (one sentence, ≤25 words). Populated for score_type=''watch'' rows.';
COMMENT ON COLUMN articles.moment_note    IS 'Watch Score MOMENT defense (one sentence, ≤25 words). Populated for score_type=''watch'' rows.';
COMMENT ON COLUMN articles.watch_summary  IS 'Watch Score 40-70 word overall verdict (the 2-3 sentence summary). Populated for score_type=''watch'' rows.';
