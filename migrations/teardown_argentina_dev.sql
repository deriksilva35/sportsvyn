-- ============================================================================
-- teardown_argentina_dev.sql  —  removes the Argentina dev seed
-- ============================================================================
-- Deleting the league cascades to teams, matches, team/player tournament stats,
-- ranking lists -> editions -> entries, odds, broadcasters, and the team_outlook
-- blurb (all FK ON DELETE CASCADE). Players are not league-scoped, so the tagged
-- squad rows are cleared explicitly (their stats already went via the league).
-- Safe to run more than once; no error if nothing is present.
-- ============================================================================

BEGIN;

DELETE FROM players WHERE metadata->>'seed' = 'argentina_dev';
DELETE FROM leagues WHERE slug = 'fifa-wc-2026';

COMMIT;
