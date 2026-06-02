-- ============================================================================
-- Migration 024 — match_briefs auto-brief uniqueness (race-safe sweep cron)
-- ============================================================================
-- Adds a partial unique index enforcing one row per match with kind='auto'.
-- Closes the race window where two overlapping /api/cron/generate-briefs
-- ticks both pass the NOT EXISTS guard simultaneously and both attempt
-- INSERT — Postgres now rejects the second at the index layer.
--
-- INSERT ... ON CONFLICT DO NOTHING in /api/cron/generate-briefs depends
-- on this index existing.
--
-- Manual briefs (kind='manual') remain unconstrained — operators can
-- re-run scripts/generate-brief.mjs --save freely while iterating. Only
-- the auto path is one-shot.
-- ============================================================================

CREATE UNIQUE INDEX idx_match_briefs_one_auto_per_match
  ON match_briefs(match_id)
  WHERE kind = 'auto';

COMMENT ON INDEX idx_match_briefs_one_auto_per_match IS
  'Race-safe idempotency for auto-brief sweep. One auto brief per match; manual briefs unconstrained.';
