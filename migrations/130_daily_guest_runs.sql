-- ============================================================================
-- 130_daily_guest_runs.sql - a signed-out play of the Daily (Option A).
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 129 is the highest in the tree.
--
-- A SEPARATE TABLE, ON PURPOSE. Every leaderboard, "beat N%" count, streak and
-- played tally reads daily_board_runs. A guest run lives HERE and nowhere
-- those reads look, so "unclaimed results never reach a board" is a property of
-- where the row is, not of a WHERE clause somebody has to remember in the
-- seventh read. A CLAIM copies the finished run into daily_board_runs for the
-- account (lib/daily/guestRuns.js claimGuestRuns), in one statement.
--
-- ONE PLAY PER DEVICE PER BOARD: UNIQUE (board_id, device_id). device_id is the
-- signed sv_gd cookie, so it is a device only as far as a cookie is - the IP
-- cap on start (ip column) is what bounds clearing it.
--
-- claim_expires_at is midnight PT at the end of the edition's ET date, written
-- at start so every guest on a board shares one deadline. claimed_by is set once
-- and never cleared: the double-claim guard is `claimed_by IS NULL` in the
-- claiming UPDATE's own WHERE.
-- ============================================================================

CREATE TABLE IF NOT EXISTS daily_guest_runs (
  id               bigserial PRIMARY KEY,
  board_id         integer NOT NULL REFERENCES daily_boards(id) ON DELETE CASCADE,
  device_id        text NOT NULL,
  ip               text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  picks            jsonb,
  score            numeric,
  pct              numeric,
  matched          integer,
  elapsed_s        integer,
  completed_at     timestamptz,
  claim_expires_at timestamptz NOT NULL,
  claimed_by       integer REFERENCES users(id) ON DELETE SET NULL,
  claimed_at       timestamptz,
  UNIQUE (board_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_guest_runs_ip
  ON daily_guest_runs (ip, started_at DESC) WHERE ip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_daily_guest_runs_device
  ON daily_guest_runs (device_id);

COMMENT ON TABLE daily_guest_runs IS
  'Signed-out Daily runs. NEVER read by a leaderboard or a beat-% count: only a claim (claimGuestRuns) copies a finished run into daily_board_runs. UNIQUE (board_id, device_id) = one play per device per board.';
