-- ============================================================================
-- 082_push_alerts.sql — who gets told, on what device, about which game.
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 081 is the highest in the tree
-- (081_news_items.sql, 081_news_feeds_seed.sql), so this is 082. Scanned the
-- target objects first: no alert_prefs and no push_sends exist in DEV or PROD
-- under any number, and device_tokens (070) has none of the four columns this
-- adds.
--
-- A DEVICE AND A PREFERENCE HAVE DIFFERENT LIFETIMES. A device is a channel and
-- dies when the browser or the phone says it has (410 Gone); a preference is a
-- statement the reader made and outlives every device they ever register. So
-- revoking a dead endpoint never touches what somebody asked for.
--
-- THE DEVICE TABLE IS device_tokens, WHICH ALREADY EXISTS (070). This widens it
-- rather than adding a second one - see the ALTER block below for why.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ONE DEVICE TABLE, NOT TWO. RULED.
--
-- This migration first proposed a second table, push_devices, for web
-- subscriptions - which need an endpoint URL and two keys, where APNs needs one
-- token. The differences are real and they are not worth a second table: two
-- device tables means two revocation paths, two fan-out queries, and a device
-- that appears twice the day somebody runs the same browser and the app. So
-- device_tokens (070) grows three nullable columns instead.
--
-- THE CHECK IS WHAT KEEPS "NULLABLE" FROM MEANING "OPTIONAL". Each platform
-- carries what its transport requires, enforced by the database rather than by
-- whichever writer happens to be careful: ios needs the token, web needs the
-- endpoint and both keys. Without it the columns quietly become optional for
-- the platform that requires them, and the failure is a silent non-delivery.
--
-- WHAT DOES NOT CHANGE: revive-in-place on conflict, revoked_at as a timestamp
-- rather than a boolean, the partial live index, and the nullable user_id that
-- lets a signed-out device still be a device. Those are 070's decisions and
-- they are still right; this only widens what a row may describe.
-- ---------------------------------------------------------------------------
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS endpoint TEXT;
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS p256dh   TEXT;
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS auth     TEXT;
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- The existing PK is `token`, so a web row still needs one: the endpoint URL
-- is written into BOTH token (the identity every existing query joins on) and
-- endpoint (what the sender actually posts to). That keeps every 070 query -
-- revoke, revive, fan-out - working unchanged on web rows.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_tokens_platform_shape') THEN
    ALTER TABLE device_tokens ADD CONSTRAINT device_tokens_platform_shape CHECK (
      (platform = 'ios' AND token IS NOT NULL)
      OR (platform = 'web' AND endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth IS NOT NULL)
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- alert_prefs — what a reader asked for, at one of two scopes.
--
-- TEAM IS THE DEFAULT, MATCH IS THE OVERRIDE, AND THE OVERRIDE IS THE ROW
-- ITSELF. There is no "inherit" value and no tri-state column: a match-scoped
-- row exists or it does not, and its mere presence means "for this game, ignore
-- what I said about the team". That keeps the resolution rule to one sentence
-- and makes "reset to team defaults" a DELETE rather than a value nobody can
-- name.
--
-- MASTER IS NOT A SIXTH TOGGLE. It gates the other five, so master=false with
-- score=true is a coherent stored state - the reader turned everything off
-- without losing what they had chosen - and the dispatcher reads master first.
--
-- final_only IS A SUPPRESSOR, NOT A SELECTOR. It sits beside the others rather
-- than replacing them for the same reason: turning it off must give the reader
-- back exactly the alerts they had before, not a blank slate.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_prefs (
  id          SERIAL      PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users("id") ON DELETE CASCADE,
  scope       TEXT        NOT NULL CHECK (scope IN ('team', 'match')),
  -- teams.id when scope='team', matches.id when scope='match'. NOT a foreign
  -- key, because one column cannot reference two tables; the dispatcher only
  -- ever reads it through a join that already constrains the scope.
  scope_id    INTEGER     NOT NULL,

  master      BOOLEAN     NOT NULL DEFAULT true,
  kickoff     BOOLEAN     NOT NULL DEFAULT true,
  score       BOOLEAN     NOT NULL DEFAULT true,
  quarter     BOOLEAN     NOT NULL DEFAULT false,
  close       BOOLEAN     NOT NULL DEFAULT true,
  final_only  BOOLEAN     NOT NULL DEFAULT false,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS alert_prefs_scope_key
  ON alert_prefs (user_id, scope, scope_id);
CREATE INDEX IF NOT EXISTS alert_prefs_lookup_idx ON alert_prefs (scope, scope_id);

-- ---------------------------------------------------------------------------
-- push_sends — one row per (device, event), and it is the DEDUPE, not a log.
--
-- THE POLLER RESTARTS. systemd sets Restart=always by design, and a dispatcher
-- that remembered what it had sent in memory would re-send every alert for
-- every in-flight game on every crash - which is the one failure mode that
-- turns a useful product into an uninstall. The unique index is what makes a
-- re-send impossible rather than unlikely: the insert conflicts and the send
-- never happens.
--
-- event_key IS THE SAME SHAPE AS THE WIRE'S dedupe_hash and for the same
-- reason. score:{match}:{home}:{away} names a score STATE, not a moment, so a
-- poll that sees the same scoreline again collides instead of notifying.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_sends (
  id          SERIAL      PRIMARY KEY,
  -- THE TOKEN, NOT AN ID, because device_tokens is keyed by token and always
  -- has been. Cascading on it means a purged device takes its send history
  -- with it, which is the same lifetime the rows describe.
  device_token TEXT       NOT NULL REFERENCES device_tokens(token) ON DELETE CASCADE,
  match_id    INTEGER     NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  event_key   TEXT        NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ok          BOOLEAN     NOT NULL DEFAULT false,
  status_code INTEGER,
  error       TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS push_sends_once
  ON push_sends (device_token, event_key);
CREATE INDEX IF NOT EXISTS push_sends_match_idx ON push_sends (match_id, sent_at DESC);
