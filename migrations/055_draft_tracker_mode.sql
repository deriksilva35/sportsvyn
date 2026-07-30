-- ============================================================================
-- Migration 055 — draft tracker mode (live in-person draft companion)
-- ============================================================================
-- Tracker mode: every pick is HUMAN-LOGGED. No AI seats, no clock. The user sits
-- at a real draft and records each team's selection as it happens. The engine is
-- unchanged — engine.applyPick already commits a specific player for an arbitrary
-- team index — so this migration only adds the three facts the schema cannot
-- currently express.
--
--   1. drafts.mode          'sim' | 'tracker'. Distinguishes the two products.
--   2. draft_picks.picked_by gains 'logged' — a pick the user RECORDED for another
--                            seat. Not 'ai' (no engine chose it) and not 'user'
--                            (not the user's roster). This distinction is load-
--                            bearing, not cosmetic: getGlobalMostDrafted filters
--                            picked_by='user', and mislabelling would leak real
--                            draft rooms into a board that reports mock-draft
--                            behaviour.
--   3. drafts.team_labels    the other managers' names ("Dave", "Sam") so the room
--                            says who is on the clock instead of "Team 7".
--
-- WHY team_labels IS jsonb ON drafts, not a draft_teams table:
--   The labels are a small fixed-size map (<= 16 entries), always read as a whole
--   with their parent draft, never queried independently, never joined, never
--   filtered. A side table would mean up to 16 rows per draft and a join on every
--   room read to reassemble something that is one value. House precedent is
--   draft_configs.roster_slots — same shape, same reasoning. drafts is also
--   already the row that freezes per-draft provenance, which is what these are.
--   Shape: JSON array of strings, index 0 = seat 1, length = teams_count.
--   NULL for sim drafts (they render "Team N"). Length is validated server-side,
--   where the config's teams_count is in hand; a CHECK here could only assert
--   jsonb type, not agreement with another table's column.
--
-- Defaults chosen so EXISTING ROWS AND CODE ARE UNAFFECTED: mode DEFAULT 'sim'
-- backfills every existing draft as what it actually is, and 'logged' only widens
-- an allowed set (no existing row changes meaning).
--
-- Depends: 046 (drafts, draft_picks). Additive. Reversible:
--   ALTER TABLE drafts DROP COLUMN mode, DROP COLUMN team_labels;
--   ALTER TABLE draft_picks DROP CONSTRAINT draft_picks_picked_by_check;
--   ALTER TABLE draft_picks ADD CONSTRAINT draft_picks_picked_by_check
--     CHECK (picked_by IN ('user','ai'));
--   (the restore is only safe while no 'logged' rows exist)
-- ============================================================================

ALTER TABLE drafts
  ADD COLUMN IF NOT EXISTS mode        text  NOT NULL DEFAULT 'sim',
  ADD COLUMN IF NOT EXISTS team_labels jsonb;

ALTER TABLE drafts DROP CONSTRAINT IF EXISTS drafts_mode_check;
ALTER TABLE drafts ADD CONSTRAINT drafts_mode_check CHECK (mode IN ('sim', 'tracker'));

-- picked_by widens to three values. Rewritten rather than added to, because a
-- CHECK cannot be extended in place.
ALTER TABLE draft_picks DROP CONSTRAINT IF EXISTS draft_picks_picked_by_check;
ALTER TABLE draft_picks ADD CONSTRAINT draft_picks_picked_by_check
  CHECK (picked_by IN ('user', 'ai', 'logged'));

-- The free-draft gate and the public most-drafted board both filter on mode now
-- (tracker drafts consume no credit and never feed the board), and both read by
-- user/status. Extends the existing idx_drafts_user_status rather than duplicating
-- it, so the gate query stays index-only.
DROP INDEX IF EXISTS idx_drafts_user_status;
CREATE INDEX idx_drafts_user_status_mode ON drafts (user_id, status, mode);

COMMENT ON COLUMN drafts.mode IS
  'sim = engine-opponent mock draft; tracker = live in-person draft, every pick human-logged. Tracker drafts never consume a free-draft credit and never feed the public most-drafted board.';
COMMENT ON COLUMN drafts.team_labels IS
  'Tracker only: JSON array of the other managers'' names, index 0 = seat 1, length = teams_count. NULL for sim drafts (rendered "Team N"). Length validated server-side.';
COMMENT ON CONSTRAINT draft_picks_picked_by_check ON draft_picks IS
  'user = the owner''s own roster pick; ai = the engine chose it (sim only); logged = the owner RECORDED another seat''s pick (tracker only).';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT mode, count(*) FROM drafts GROUP BY 1;          -- all existing = 'sim'
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'draft_picks_picked_by_check';        -- 3 values
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'drafts_mode_check';                  -- sim | tracker
--   SELECT indexname FROM pg_indexes WHERE tablename='drafts';
--   -- refuse a bad mode (expect ERROR):
--   -- INSERT INTO drafts (user_id, status, mode, pool_snapshot_date,
--   --   pool_scoring_format, pool_teams_count) VALUES (1,'in_progress','nope','2026-01-01','ppr',12);
-- ----------------------------------------------------------------------------
