-- ============================================================================
-- 132_confidence_pickem.sql - confidence Pick'em: a rank sheet and a per-entry max.
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 131 is the highest in the tree.
--
-- RULING (tue-7): from 20 Oct 2026 NFL, CFB and NBA boards are CONFIDENCE
-- boards - every game on the board is ranked 1..N, and a right pick scores
-- its rank. Which boards are confidence is stamped on the BOARD
-- (contests.meta.scoring = 'confidence', at creation), so a board already open
-- never changes. That stamp needs no column.
--
-- ranks      {match_id: int} - the entry's rank sheet. A column of its own,
--            never nested in lineup (many readers take lineup[match] as a bare
--            side string) and never in meta (a nested key meets the shallow-||
--            law). NULL on every pre-existing entry and on every REGULAR board.
-- max_score  the most THIS entry could have scored: the sum of its own ranks
--            over the games that had a winner. Per entry, because every entry
--            ranks its own sheet - it cannot live in contests.perfect.max.
--            NULL on every REGULAR entry (those rank on wins, as before).
--
-- ADDITIVE AND REVERSIBLE: two nullable columns, no default, no rewrite.
--   undo: ALTER TABLE contest_entries DROP COLUMN ranks, DROP COLUMN max_score;
-- ============================================================================

ALTER TABLE contest_entries ADD COLUMN IF NOT EXISTS ranks jsonb;
ALTER TABLE contest_entries ADD COLUMN IF NOT EXISTS max_score numeric;

COMMENT ON COLUMN contest_entries.ranks IS
  'Confidence Pick''em rank sheet {match_id: int}. NULL = REGULAR board or never saved (readers fall back to the kickoff-order default).';
COMMENT ON COLUMN contest_entries.max_score IS
  'Confidence Pick''em: this entry''s own maximum (sum of its ranks over games with a winner), written at settle and re-grade. NULL on REGULAR boards.';
