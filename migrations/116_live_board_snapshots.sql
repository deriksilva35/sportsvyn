-- 116_live_board_snapshots.sql - where every live board entry stood, and when.
--
-- NUMBERED 116, NOT 115. main's highest file is 114, but 115 is taken by
-- 115_nfl_power_z_list.sql on the held nfl-power-z branch; two files claiming
-- one number would collide the day that branch lands.
--
-- WHY A TABLE. The live boards (/weekly/board, /draft/board) are computed on
-- read from the stat rows, which is exact for NOW and blind to THEN. "Up 312
-- in the last 10 minutes" and the 10m column need where each entry stood ten
-- minutes ago, and nothing else in the database remembers that.
--
-- ONE ROW PER CHANGE, not per poll. The poller snapshots a contest after a box
-- score that changed something (lib/boards/live.js snapshotLiveBoards) and
-- writes a row only for an entry whose points or rank moved since its last
-- row. An entry's standing at time T is its newest row at or before T.
--
--   contest_id  the board (contests.id)
--   user_id     the entry's owner (one entry per user per contest)
--   ts          when the poller computed it
--   points      the live total (before drop-worst for the Weekly, best-ball
--               six for the Draft - the board's own number)
--   rank        competition rank at ts (ties share a rank)
--
-- IDEMPOTENT: CREATE ... IF NOT EXISTS throughout. Reversible: DROP TABLE.

CREATE TABLE IF NOT EXISTS live_board_snapshots (
  id          BIGSERIAL PRIMARY KEY,
  contest_id  INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  points      NUMERIC(8,2) NOT NULL,
  rank        INTEGER NOT NULL CHECK (rank >= 1)
);

-- "Each entry's newest row at or before T" - DISTINCT ON (user_id) ... ORDER BY ts DESC.
CREATE INDEX IF NOT EXISTS live_board_snapshots_contest_user_ts
  ON live_board_snapshots (contest_id, user_id, ts DESC);
