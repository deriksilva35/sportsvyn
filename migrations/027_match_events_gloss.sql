-- ============================================================================
-- Migration 027 — match_events.gloss
-- ============================================================================
-- Per-event AI-generated gloss for the Live Key Moments feed.
-- Lifecycle is tied to the match_events row: when is_current flips false
-- (VAR overturn / corrected event), the gloss dies with the row in the
-- render path. A corrected replacement event is a fresh insert with
-- gloss = NULL, which the generation pass refills.
--
-- State machine for the column value:
--   NULL  — qualifying event present, gloss not yet generated. The
--           generation pass (app/api/cron/generate-gloss) picks this up.
--   ''    — empty string: "we tried, model returned null OR gates dropped
--           the gloss OR the API errored". Distinct from NULL so the
--           pass does NOT retry forever on legitimately-null moments.
--   text  — gate-passing gloss to render under the structured row.
--
-- Why a column on match_events instead of a sidecar table: per-event
-- lifecycle binding (the row IS the unit), VAR lockstep for free
-- (gloss disappears with its parent on is_current=false), no join in
-- the render hot path, no orphan rows possible.
--
-- The poller's UPSERT in lib/events.js (syncMatchEvents) explicitly
-- lists the columns it updates on conflict — gloss is NOT in that list,
-- so the column is sticky across poll ticks: once written, the gloss
-- survives every subsequent live poll on the same row.
--
-- Safe to apply against rows that exist: existing rows get gloss = NULL,
-- which the generation pass will fill on its next sweep.
-- ============================================================================

ALTER TABLE match_events ADD COLUMN gloss text;

COMMENT ON COLUMN match_events.gloss IS
  'AI-generated one-sentence gloss for the Live Key Moments feed. NULL = not yet generated; '''' = generated-but-empty (model null or gates dropped, do not retry); text = gate-passing gloss to render. Lifecycle-tied to the row via is_current.';
