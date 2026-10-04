-- 126_contest_entries_submitted_at.sql - WHEN THE READER COMMITTED.
--
-- RULING sun-16 item C: tied scores share the higher place (1, 1, 3) on every
-- board, and within a tie the EARLIEST SUBMISSION is listed first
-- (lib/games/rank.js). That needs a submission instant per entry, and
-- contest_entries had none it could trust:
--
--   updated_at   bumped by EVERY writer - the lock (lib/weekly/entries.js
--                lockEntries), every settle, the regrade, the confirm button.
--                After settle it is the settle's clock, not the reader's.
--   locked_at    the CONTEST's lock for the Weekly, the settle's now() for the
--                rest - the same instant for everyone on the board.
--   created_at   the FIRST save. Honest, but not the commit: the lineup is
--                editable until its games lock.
--
-- submitted_at is the LAST write the reader made to their own entry (a save, a
-- pick, a clear; for the Draft, the finished roster landing on the entry), and
-- nothing else writes it. Readers order ties by COALESCE(submitted_at,
-- created_at), so a row this backfill could not date still sorts somewhere
-- honest.
--
-- THE BACKFILL recovers the real instant where the data still holds it, in
-- this order:
--   1. Pick'em day boards stamp every pick (meta.picked_at {match: iso}) -
--      the latest stamp.
--   2. Six stamps every slot (lineup.<slot>.picked_at), The Run every slot
--      (lineup.<slot>.at) - the latest stamp.
--   3. The Draft: the room's drafts.completed_at.
--   4. An entry nothing has locked or settled yet: updated_at is still the
--      reader's own last save.
--   5. Otherwise created_at.
-- Only well-formed ISO strings are cast (the regex guard), so one odd value
-- cannot fail the migration.

ALTER TABLE contest_entries ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

COMMENT ON COLUMN contest_entries.submitted_at IS
  'The reader''s last write to their own entry (save, pick, clear; the Draft''s stored roster). Never written by lock, settle or confirm. Orders a tie: earliest first (lib/games/rank.js).';

UPDATE contest_entries e
   SET submitted_at = COALESCE(
     (SELECT max(v.value::timestamptz)
        FROM jsonb_each_text(CASE WHEN jsonb_typeof(e.meta->'picked_at') = 'object' THEN e.meta->'picked_at' ELSE '{}'::jsonb END) v
       WHERE v.value ~ '^\d{4}-\d{2}-\d{2}T'),
     (SELECT max(COALESCE(s.value->>'picked_at', s.value->>'at')::timestamptz)
        FROM jsonb_each(CASE WHEN jsonb_typeof(e.lineup) = 'object' THEN e.lineup ELSE '{}'::jsonb END) s
       WHERE jsonb_typeof(s.value) = 'object'
         AND COALESCE(s.value->>'picked_at', s.value->>'at') ~ '^\d{4}-\d{2}-\d{2}T'),
     (SELECT d.completed_at FROM drafts d
       WHERE d.id = CASE WHEN e.meta->>'draftId' ~ '^[0-9]+$' THEN (e.meta->>'draftId')::int END),
     (SELECT e.updated_at FROM contests c
       WHERE c.id = e.contest_id AND e.locked_at IS NULL AND c.settled IS NOT TRUE),
     e.created_at)
 WHERE e.submitted_at IS NULL;
