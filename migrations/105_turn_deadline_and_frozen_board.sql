-- 105_turn_deadline_and_frozen_board.sql - what a room stores when it comes to
-- rest, and what it must not recompute while it is running.
--
-- TWO COLUMNS IN ONE MIGRATION, DELIBERATELY. They are the same fact from two
-- sides: everything a draft has to REMEMBER between one request and the next.
-- Both were discovered in the same week, both are writes at the same moment
-- (the room comes to rest on a human turn / the room starts), and shipping
-- them as two migrations would mean two dual-GOs for one idea.
--
-- ---------------------------------------------------------------------------
-- 1. drafts.turn_deadline_at - THE CLOCK STOPS BEING A DECORATION
-- ---------------------------------------------------------------------------
-- The room's countdown lives in the CLIENT. A phone that sleeps mid-turn wakes
-- with a timer that never ticked, so room 543 sat on 7.06 for hours: nothing
-- in the system knew the turn had expired, because the only thing counting was
-- a setInterval in a backgrounded tab. Storing the deadline moves the fact
-- server-side, where a read can act on it.
--
-- NULL MEANS NO DEADLINE, and it is the right default for every existing row:
-- an untimed practice mock never gets one, and a room mid-turn when this ships
-- gets its deadline on the next write rather than retroactively (a backfilled
-- deadline would be a deadline nobody was shown).
--
-- ---------------------------------------------------------------------------
-- 2. draft_boards - THE BOARD A ROOM DRAFTS IS THE BOARD IT STARTED WITH
-- ---------------------------------------------------------------------------
-- lib/draft/ourBoard.js computes value from finals as they land, so a board
-- recomputes on every load. That is correct for a NEW room and wrong for a
-- RUNNING one: a room open across Thursday night would see its order change
-- under the reader between two taps, and the ADP column - which is the board
-- rank - would disagree with the adp_at_pick frozen on the picks already made.
--
-- pool_snapshot_date froze WHICH FFC snapshot a room drafted. Our own board
-- has no snapshot to name, so the rows themselves are the freeze. One row per
-- draft, written once at start, read by poolFor.
--
-- ON DELETE CASCADE: a board is meaningless without its draft, and drafts are
-- deleted in test teardown.
--
-- jsonb, NOT a row per player. The board is read whole, always, by exactly one
-- caller, and it is never queried by player - so a table of 304 rows per draft
-- would be 304 rows of write amplification for no read we make.

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS turn_deadline_at timestamptz;

COMMENT ON COLUMN drafts.turn_deadline_at IS
  'When the human turn on the clock expires. NULL for an untimed room or a room not resting on a human turn.';

CREATE TABLE IF NOT EXISTS draft_boards (
  draft_id    integer PRIMARY KEY REFERENCES drafts(id) ON DELETE CASCADE,
  computed_at timestamptz NOT NULL,
  label       text,
  rows        jsonb NOT NULL
);

COMMENT ON TABLE draft_boards IS
  'The board a draft froze at start, when its pool_source has no snapshot to name. One row per draft, written once.';
