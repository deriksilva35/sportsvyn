-- 125_draft_contest_boards.sql - ONE BOARD PER RANKED WEEK, not one per room.
--
-- RULING D1 (sat-5). The seat screen says that everyone at seat N starts from
-- the same room. Two things have to be true for that sentence: the bots are
-- seeded by (contest, seat, pick number) rather than by the room's id - that
-- is code, lib/draft/roomSeed.js - and every room of the week drafts the SAME
-- BOARD. Until now each room computed lib/draft/ourBoard.js at its own start
-- and froze that (draft_boards, migration 105), so a room opened on Tuesday
-- and a room opened on Thursday could draft different orders, and identical
-- seeds would still have produced different rooms.
--
-- FROZEN AT THE WEEK'S FIRST ROOM START, not at contest creation. The contest
-- row is written by lib/weekly/create.js ensureWeek, the Weekly's creator,
-- in one transaction with the Weekly row; computing the Sportsvyn board there
-- would put the heaviest read in this game inside another game's creator and
-- its cron. The first start is the one write path every ranked room already
-- goes through, it is idempotent (ON CONFLICT DO NOTHING, then read back the
-- winner), and a week nobody drafts never computes a board at all.
--
-- EACH ROOM STILL FREEZES ITS OWN COPY into draft_boards. poolFor reads that
-- row and nothing about it changes; this table is only where the copy comes
-- from.
--
-- ON DELETE CASCADE: a board is meaningless without its contest, and test
-- teardown deletes contests.

CREATE TABLE IF NOT EXISTS draft_contest_boards (
  contest_id  integer PRIMARY KEY REFERENCES contests(id) ON DELETE CASCADE,
  computed_at timestamptz NOT NULL,
  label       text,
  rows        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE draft_contest_boards IS
  'The board every ranked Draft room of one contest drafts from, frozen at the week''s first room start. Written once.';
