-- ============================================================================
-- Migration 045 — gridiron provider game-id indexes (BDL + CFBD)
-- ============================================================================
-- Why this exists: migration 044 was transcribed verbatim from the
-- SportsData.io-era design draft, whose partial unique indexes key on
-- external_ids->>'sportsdata_score_id' (NFL) and ->>'sportsdata_game_id' (CFB).
-- The vendor spike (~/scratch/football-vendor-spike/) changed the providers: the
-- launch feeds are BallDontLie (NFL) and CollegeFootballData (CFB), which key on
-- 'bdl_game_id' and 'cfbd_game_id'. This migration adds the matching partial
-- unique indexes for the REAL providers so game sync is idempotent (the
-- upsert's guard rail: a second insert of the same provider game id is rejected).
--
-- 044's sportsdata_* indexes are LEFT IN PLACE: they are harmless (partial,
-- WHERE external_ids ? 'sportsdata_*', so they index nothing until/unless a
-- dormant SportsData feed is ever wired) and dropping them is churn for no gain.
--
-- Depends: 044 (matches gridiron columns + the sportsdata_* indexes).
-- Additive + reversible: DROP the two indexes to revert. No data change.
-- ============================================================================

-- NFL game identity: BallDontLie game id, unique within a league. Partial so
-- soccer / CFB rows (no such key) are excluded.
CREATE UNIQUE INDEX idx_matches_bdl_game_id
  ON matches (league_id, (external_ids->>'bdl_game_id'))
  WHERE external_ids ? 'bdl_game_id';

-- CFB game identity: CollegeFootballData game id, unique within a league.
CREATE UNIQUE INDEX idx_matches_cfbd_game_id
  ON matches (league_id, (external_ids->>'cfbd_game_id'))
  WHERE external_ids ? 'cfbd_game_id';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT indexname FROM pg_indexes WHERE tablename='matches'
--    AND indexname IN ('idx_matches_bdl_game_id','idx_matches_cfbd_game_id');
--   -- expect both present.
-- ----------------------------------------------------------------------------
