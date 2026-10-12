-- 138_mock_nba_adp_records_settings.sql - the NBA mock draft's ADP column, its
-- anonymous record of finished mocks, and a signed-in reader's saved setup (sun-7).
--
-- mock_nba_adp: an outside ranking list matched to our pool (lib/mockNba/adp.js) -
--   rank and position eligibility ONLY; no stats or projections are stored.
-- nba_mock_drafts: every finished mock's picks, ANONYMOUS (no user id, no IP), so a
--   real "SV ADP" can be computed once enough exist (~300).
-- nba_mock_settings: one row per signed-in reader: the setup the next mock opens with.
--
-- ADDITIVE. UNDO: DROP TABLE mock_nba_adp; DROP TABLE nba_mock_drafts; DROP TABLE nba_mock_settings;
CREATE TABLE IF NOT EXISTS mock_nba_adp (
  player_id   integer PRIMARY KEY,
  adp_rank    integer NOT NULL,
  positions   text[]  NOT NULL DEFAULT '{}',
  source_date date    NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nba_mock_drafts (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  teams       smallint NOT NULL CHECK (teams BETWEEN 8 AND 14),
  rounds      smallint NOT NULL CHECK (rounds BETWEEN 1 AND 36),
  scoring     text     NOT NULL,
  roster      text     NOT NULL,
  user_seat   smallint NOT NULL,
  grade       text,
  picks       integer[] NOT NULL
);
CREATE INDEX IF NOT EXISTS nba_mock_drafts_created_idx ON nba_mock_drafts (created_at);

CREATE TABLE IF NOT EXISTS nba_mock_settings (
  user_id     integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings    jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
