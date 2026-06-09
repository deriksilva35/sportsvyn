-- ============================================================================
-- Migration 030 — Athletic source for ranking_entries (3-source sites layer)
-- ============================================================================
-- Purpose: Adds two nullable columns to ranking_entries for the third sites-
--          layer source (The Athletic). The Phase 1 sites layer was FIFA +
--          ESPN (50/50) per migration 011 + sitesLayer.js. We're moving to
--          a 3-source equal-thirds blend (FIFA + ESPN + Athletic) for more
--          robust authority signal.
-- Depends: 011_rankings (defines ranking_entries with fifa_*, espn_*,
--          sites_composite)
-- Shape:   Additive + nullable only. Existing rows stay untouched. No
--          backfill. New edition runs populate these going forward.
-- ============================================================================

ALTER TABLE ranking_entries
  ADD COLUMN IF NOT EXISTS athletic_rank   integer,
  ADD COLUMN IF NOT EXISTS athletic_score  numeric(4,2);

COMMENT ON COLUMN ranking_entries.athletic_rank IS 'The Athletic''s within-field rank (1..N) for the entity. Nullable when the source is unavailable for this entry. Normalized score lives in athletic_score.';
COMMENT ON COLUMN ranking_entries.athletic_score IS 'Power-curve normalized score (0..10) derived from athletic_rank via lib/rankings/sitesLayer.js. Nullable when the source is unavailable. Combined with fifa_score + espn_score into sites_composite (equal thirds).';

-- ----------------------------------------------------------------------------
-- Sanity check (run after apply):
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'ranking_entries'
--      AND column_name IN ('athletic_rank', 'athletic_score');
--   -- Expect 2 rows: athletic_rank (integer, YES), athletic_score (numeric, YES).
-- ----------------------------------------------------------------------------
