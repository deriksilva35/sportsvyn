-- ============================================================================
-- Migration 061 - API-Sports gridiron identity
-- ============================================================================
-- API-Sports (american-football v1) becomes a THIRD gridiron game provider,
-- alongside BallDontLie (NFL) and CollegeFootballData (CFB). It is here for one
-- thing the others do not carry: NFL PRESEASON. BDL has no preseason at all, so
-- there is no route to the Aug 13-17 slate through the existing feeds.
--
-- Nothing about the existing feeds changes. This adds the identity index that
-- makes an API-Sports import idempotent, in the same shape as migration 045.
--
-- WHAT THIS DOES NOT PREVENT, stated plainly so nobody assumes otherwise: a
-- partial unique index on apisports_game_id stops the SAME provider inserting a
-- game twice. It does NOT stop two DIFFERENT providers each inserting a row for
-- the same real fixture - lib/gridiron/sync.js looks a game up by
-- (league_id, external_ids->>'<provider>_game_id'), which is provider-scoped, so
-- a second provider always misses and always inserts. Preseason is not currently
-- double-sourced (BDL carries none), which is why this is safe TODAY; if
-- API-Sports is ever pointed at the regular season, the importer needs a
-- cross-provider match on (league, kickoff, teams) BEFORE it inserts. That is a
-- design decision, not a migration.
--
-- teams.external_ids gains apisports_team_id via scripts/map-apisports-teams.mjs
-- rather than here: it is a data write resolved against the live API (32 exact
-- name matches, verified), not DDL, and it wants a dry run before it touches a
-- row.
--
-- Depends: 044 (gridiron columns), 045 (the bdl/cfbd indexes this mirrors).
-- Additive + reversible: DROP the index to revert. No data change.
-- ============================================================================

-- NFL/CFB game identity from API-Sports, unique within a league. Partial, so
-- every row that predates this provider - which is all of them - is excluded.
CREATE UNIQUE INDEX idx_matches_apisports_game_id
  ON matches (league_id, (external_ids->>'apisports_game_id'))
  WHERE external_ids ? 'apisports_game_id';

-- Team lookups during import run league-scoped on this key, and there are two
-- of them per game. Not unique: enforcing uniqueness here would fail the whole
-- import on a provider-side duplicate rather than letting the mapper report it.
CREATE INDEX idx_teams_apisports_team_id
  ON teams (league_id, (external_ids->>'apisports_team_id'))
  WHERE external_ids ? 'apisports_team_id';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT indexname FROM pg_indexes
--    WHERE indexname IN ('idx_matches_apisports_game_id',
--                        'idx_teams_apisports_team_id');
--   -- expect both present.
-- ----------------------------------------------------------------------------
