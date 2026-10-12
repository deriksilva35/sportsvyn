-- 141_mock_settings_compat.sql - put nba_mock_settings back the way the shipped
-- code reads it (mon-3).
--
-- 140 turned nba_mock_settings into one row per (user_id, sport). The code on
-- main writes it with ON CONFLICT (user_id), which then has no constraint to
-- match - so every NBA "save my setup" failed on any database that had 140
-- before the code that understands it (DEV, found by a full suite). The NFL
-- mock's saved setup moves to its own table instead, and the NBA table returns
-- to one row per account. The other two sport columns 140 added (nba_mock_setups,
-- nba_mock_drafts) are default-'nba' additions the old code ignores; they stay.
--
-- UNDO: DROP TABLE nfl_mock_settings; (and 140's UNDO).
CREATE TABLE IF NOT EXISTS nfl_mock_settings (
  user_id     integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings    jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO nfl_mock_settings (user_id, settings, updated_at)
SELECT user_id, settings, updated_at FROM nba_mock_settings WHERE sport = 'nfl'
ON CONFLICT (user_id) DO NOTHING;
DELETE FROM nba_mock_settings WHERE sport <> 'nba';

ALTER TABLE nba_mock_settings DROP CONSTRAINT IF EXISTS nba_mock_settings_pkey;
ALTER TABLE nba_mock_settings ADD PRIMARY KEY (user_id);
ALTER TABLE nba_mock_settings DROP COLUMN IF EXISTS sport;
