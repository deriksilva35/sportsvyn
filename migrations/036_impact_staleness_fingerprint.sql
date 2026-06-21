-- migrations/036_impact_staleness_fingerprint.sql
-- Staleness fingerprint column on ranking_entries for the impact_score cache.
--
-- Mirrors the Phase 1 pattern (editorial_blurbs.approved_against_fingerprint):
-- the player's event-count fingerprint AT THE MOMENT IMPACT WAS GRADED is
-- stamped onto the row. The next edition's scheduler compares the stored
-- fingerprint to the player's CURRENT fingerprint:
--
--   if cached_fp == current_fp -> reuse impact (player's data unchanged)
--   else                       -> call scoreImpact fresh (data shifted)
--
-- NULL means "no fingerprint stamped" (legacy / pre-fix rows). The scheduler
-- treats NULL as "force a fresh re-score" -- the SAFE direction. Never reuse
-- an unstamped cache.
--
-- Idempotent: safe to replay against PROD or DEV.

ALTER TABLE ranking_entries
  ADD COLUMN IF NOT EXISTS impact_scored_against_fingerprint integer;
