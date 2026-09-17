-- 103: daily_boards.slots - a board remembers its OWN shape.
--
-- THE DEFECT THIS CLOSES, MEASURED BEFORE IT WAS WRITTEN. The slot list was a
-- frozen constant in code (lib/daily/boardShape.js) that every reader imported
-- and passed in fresh at read time - nine call sites across the run route, the
-- board page and the archive page. A board's `board`, `ceiling` and
-- `best_roster` are frozen at creation; its SHAPE was not. So changing the
-- constant re-read every edition ever played under the new shape.
--
-- What that would have cost, run against PROD's nine editions and their 17
-- stored runs with the ranked shape (QB RB RB WR WR TE FLEX K):
--   regrade today  15 of 17 runs
--   regrade after   4 of 17
-- Eleven working receipts would have started failing with "Steve Largent (WR)
-- is not eligible for TE", and two boards (1982, 1991) would have become
-- unsolvable outright - those twelve cards cannot field a tight end between
-- them, which is exactly the 1980s scarcity the original eight-slot ruling
-- dropped the TE slot to avoid.
--
-- A FROZEN BOARD KEEPS ITS OWN SHAPE FOREVER. That is what the ruling meant,
-- and a column is the only way it holds literally rather than approximately.
--
-- NO DEFAULT, ON PURPOSE. The nine existing rows are backfilled explicitly
-- below with the shape they were actually created under; after that the column
-- is NOT NULL with no default, so a writer that forgets to state a shape fails
-- loudly at INSERT instead of silently inheriting yesterday's.

ALTER TABLE daily_boards ADD COLUMN IF NOT EXISTS slots jsonb;

-- The eight every existing edition was drawn, solved and graded under.
UPDATE daily_boards
   SET slots = '["QB","RB","RB","WR","WR","FLEX","FLEX","K"]'::jsonb
 WHERE slots IS NULL;

ALTER TABLE daily_boards ALTER COLUMN slots SET NOT NULL;

COMMENT ON COLUMN daily_boards.slots IS
  'The slot shape this board was created under, frozen with it. Readers use board.slots, never the current code constant - an edition graded under QB/RB/RB/WR/WR/FLEX/FLEX/K keeps regrading under it after the ranked shape adds a TE slot.';

-- ---------------------------------------------------------------------------
-- VERIFY (DEV first, then PROD):
--   SELECT id, edition_date, season_year, slots FROM daily_boards ORDER BY id;
--   -- every existing row: ["QB","RB","RB","WR","WR","FLEX","FLEX","K"]
--   SELECT count(*) FROM daily_boards WHERE slots IS NULL;   -- 0
