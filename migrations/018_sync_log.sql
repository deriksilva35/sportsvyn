-- Migration 018 — sync_log
-- ============================================================================
-- Persistent poll log for live-fixture syncs. Each invocation of
-- lib/syncFixture.js (whether from the poller route or a CLI script)
-- writes exactly one row here, including failures. The row is the audit
-- record for "what did we see, and when did we see it" — replay-match.mjs
-- consumes this table to print the post-match timeline.
--
-- raw is the trimmed payload: { status, minute, goals, events_count }
-- only. Not the full fixture object — we want a readable timeline, not a
-- 50KB blob per poll.
-- ============================================================================

CREATE TABLE sync_log (
  id           bigserial PRIMARY KEY,
  fixture_id   integer NOT NULL,        -- api_sports fixture id
  polled_at    timestamptz NOT NULL DEFAULT now(),
  status       text,                    -- mapped status at poll time
  minute       integer,                 -- match minute if live
  home_score   integer,
  away_score   integer,
  raw          jsonb,                   -- the trimmed API payload for this poll
  error        text                     -- non-null if the poll failed
);

CREATE INDEX idx_sync_log_fixture ON sync_log(fixture_id, polled_at);
