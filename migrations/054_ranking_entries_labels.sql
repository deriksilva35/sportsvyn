-- ============================================================================
-- Migration 054 — ranking_entries label/read columns (hand-seeded editorial boards)
-- ============================================================================
-- The gridiron preseason boards (Power Rankings, MVP, the Sportsvyn 25, Heisman)
-- are hand-authored Edition 0 rows. Player boards must carry a NAME with NO player
-- row (CFB players are not ingested and must not become a dependency), and the
-- "read" prose belongs on the entry itself (not the soccer editorial_blurbs path).
--
-- Additive columns on ranking_entries:
--   selection_label  text  -- the display name when there's no team_id/player_id
--   team_tag         text  -- a player board's team tag (e.g. "Buffalo")
--   band             text  -- 'dark_horse' -> the DARK HORSES render band
--   read             text  -- the one-observation serif read (NULL = rank-only row)
--
-- And the entity/id CHECK is relaxed so an entry may be identified by a label
-- alone (team_id AND player_id both NULL), keeping the existing team_id/player_id
-- paths intact. Reversible: drop the four columns, restore the strict CHECK.
-- Depends: 011 (rankings).
-- ============================================================================

ALTER TABLE ranking_entries
  ADD COLUMN IF NOT EXISTS selection_label text,
  ADD COLUMN IF NOT EXISTS team_tag        text,
  ADD COLUMN IF NOT EXISTS band            text,
  ADD COLUMN IF NOT EXISTS read            text;

ALTER TABLE ranking_entries DROP CONSTRAINT IF EXISTS ranking_entries_check;
ALTER TABLE ranking_entries ADD CONSTRAINT ranking_entries_check CHECK (
  (entity_type = 'team'   AND player_id IS NULL AND (team_id   IS NOT NULL OR selection_label IS NOT NULL)) OR
  (entity_type = 'player' AND team_id   IS NULL AND (player_id IS NOT NULL OR selection_label IS NOT NULL)) OR
  (entity_type IN ('goal', 'manager'))
);

COMMENT ON COLUMN ranking_entries.selection_label IS 'Display name when no team_id/player_id (hand-seeded gridiron boards; no player dependency).';
COMMENT ON COLUMN ranking_entries.team_tag        IS 'Player board team tag, e.g. "Buffalo".';
COMMENT ON COLUMN ranking_entries.band            IS 'dark_horse -> rendered under a DARK HORSES band; NULL otherwise.';
COMMENT ON COLUMN ranking_entries.read            IS 'One-observation serif read; NULL for a rank-only row.';
