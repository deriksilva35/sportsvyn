-- ============================================================================
-- 134_league_pick_format_pending.sql - a QUEUED Pick'em format (S2, wed-1).
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 133 is the highest in the tree.
--
-- After a league's first week locks, the commissioner's format change is no
-- longer refused: it is queued here and applied at the league's next season
-- (lib/leagues/rollover.js: pick_format = pending, pending = NULL, one UPDATE).
-- NULL = nothing queued. Same value set as pick_format.
--
-- ADDITIVE AND REVERSIBLE: one nullable column, no existing value touched.
--   undo: ALTER TABLE player_leagues DROP COLUMN pick_format_pending;
-- ============================================================================

ALTER TABLE player_leagues ADD COLUMN IF NOT EXISTS pick_format_pending text;

ALTER TABLE player_leagues DROP CONSTRAINT IF EXISTS player_leagues_pick_format_pending_check;
ALTER TABLE player_leagues ADD CONSTRAINT player_leagues_pick_format_pending_check
  CHECK (pick_format_pending IS NULL OR pick_format_pending IN ('regular', 'confidence', 'ats'));
