-- ============================================================================
-- Migration 032 — players.external_ids->>'api_sports' partial unique
-- ============================================================================
-- Purpose: Belt-and-suspenders uniqueness gate on the API-Sports player id.
--          The squadImport.js find-then-upsert path is correct for a single-
--          tenant ingester, but a future concurrent caller (or any manual
--          INSERT) could create a duplicate. The partial unique index makes
--          duplicate inserts impossible at the database layer.
--
-- Shape:   PARTIAL unique — only constrains rows that HAVE an api_sports id.
--          Manually-created players without an external api id are exempt
--          (a real use case: an editor adds a player who isn't in
--          API-Sports's catalog).
--
-- DEV pre-check: confirmed 0 duplicates + 0 NULL-api players. Index creation
-- safe (no conflict surface).
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_players_api_sports
  ON players ((external_ids->>'api_sports'))
  WHERE external_ids->>'api_sports' IS NOT NULL;

COMMENT ON INDEX uq_players_api_sports IS 'Partial unique index — guarantees one players row per API-Sports player id. NULL/absent api_sports id rows are exempt (the partial predicate excludes them).';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT indexname, indexdef FROM pg_indexes
--    WHERE tablename = 'players' AND indexname = 'uq_players_api_sports';
--   -- expect one row with WHERE clause "(external_ids ->> 'api_sports') IS NOT NULL".
-- ----------------------------------------------------------------------------
