-- 135_app_errors.sql - uncaught errors from the droplet services (live-poller,
-- daily-tick, mlb-advance), one row per (service, stack_hash).
-- Written by lib/ops/appErrors.js: a repeat is count+1, ts = now(), message refreshed.
-- ADDITIVE. UNDO: DROP TABLE app_errors;
CREATE TABLE IF NOT EXISTS app_errors (
  id          bigserial PRIMARY KEY,
  service     text        NOT NULL,
  message     text        NOT NULL,
  stack_hash  text        NOT NULL,
  count       int         NOT NULL DEFAULT 1,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  ts          timestamptz NOT NULL DEFAULT now()   -- last seen
);
CREATE UNIQUE INDEX IF NOT EXISTS app_errors_service_hash_uq ON app_errors (service, stack_hash);
CREATE INDEX IF NOT EXISTS app_errors_ts_idx ON app_errors (ts DESC);

-- crew_reader (a read-only role created separately) gets SELECT when it exists.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='crew_reader') THEN GRANT SELECT ON app_errors TO crew_reader; END IF; END $$;
