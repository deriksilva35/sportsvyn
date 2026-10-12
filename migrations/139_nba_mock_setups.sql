-- 139_nba_mock_setups.sql - a signed-in reader's NAMED NBA mock setups (mon-2).
--
-- "Save as..." on /mock/nba stores the whole setup (teams, draft slot, scoring
-- incl. custom values, roster incl. custom counts, clock) under a name the reader
-- chooses; at most 10 per account (enforced in lib/mockNba/setups.js). Names are
-- unique per account, case-insensitively. Guests cannot save.
--
-- ADDITIVE. UNDO: DROP TABLE nba_mock_setups;
CREATE TABLE IF NOT EXISTS nba_mock_setups (
  id          bigserial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text    NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  settings    jsonb   NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS nba_mock_setups_user_name_idx ON nba_mock_setups (user_id, lower(name));
