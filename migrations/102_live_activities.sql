-- 102: Live Activity tokens - one row per Activity, per the contract.
--
-- AN ACTIVITY IS NOT A DEVICE, which is why this is not a column on
-- device_tokens. A device holds ONE APNs device token for its whole install
-- and every alert goes to it; an Activity is started per game, gets its OWN
-- push token from Activity.pushTokenUpdates, lives for an afternoon and then
-- is gone forever. One phone watching two games has two live rows here and
-- still one row in device_tokens. Keying this on the device token would make
-- the second game overwrite the first.
--
-- THE ACTIVITY ID IS THE KEY, as the app sees it. The push token is NOT the
-- key: Apple reissues a token for the SAME Activity (the app is told through
-- pushTokenUpdates, which is a stream, not a one-shot), so a re-register
-- carrying a new token must UPDATE this row, not insert a second one.
--
-- THREE WAYS AN ACTIVITY DIES, and they are kept apart because they mean
-- different things on a Tuesday morning post-mortem:
--   ended_at    the app said it is gone (POST /api/live-activity/end), or we
--               sent event:"end" at final. A normal death.
--   revoked_at  APNs said the token is dead (410 / BadDeviceToken /
--               Unregistered). 070's single revocation path, same shape.
--   (neither)   live, and eligible for an update push.
-- A boolean would forget which, and "why did this stop updating" is exactly
-- the question a live-scoring bug asks.

CREATE TABLE IF NOT EXISTS live_activities (
  activity_id text PRIMARY KEY,
  push_token  text NOT NULL,
  -- NULLABLE, like device_tokens.user_id: the Activity outlives the session
  -- that started it, and a deleted account must not cascade a running
  -- Activity out of existence mid-game.
  user_id     integer REFERENCES users(id) ON DELETE SET NULL,
  match_id    integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  -- The app's own startedAt, kept as it sent it. Distinct from created_at:
  -- an Activity started offline registers late, and the gap is a real fact.
  started_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  revoked_at  timestamptz
);

-- THE FAN-OUT QUERY: every Activity still alive for one match. Partial for
-- the same reason 070's is - dead rows are kept for the record and never
-- read on the hot path, and at final every row for a match goes dead at once.
CREATE INDEX IF NOT EXISTS live_activities_live_idx
  ON live_activities (match_id)
  WHERE ended_at IS NULL AND revoked_at IS NULL;

COMMENT ON TABLE live_activities IS
  'One row per iOS Live Activity: its APNs push token, the match it is for, and how it died.';
