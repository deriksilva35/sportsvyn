-- ============================================================================
-- Migration 046 — mock draft sim schema (FFC ADP pool + configs + drafts + picks)
-- ============================================================================
-- First schema for the mock-draft sim (mid-Aug MVP funnel product). Design from
-- the product-decisions sketch, adapted to Fantasy Football Calculator's real
-- ADP payload (recon: ~/scratch/sim-spike/).
--
-- Product rules encoded here:
--   · Config-driven: presets are draft_configs ROWS (user_id NULL), not code.
--     Perks unlock parameters, not features.
--   · Entitlement is DERIVED from a user's drafts count — there is NO counter
--     column anywhere in this schema.
--   · FFC is the ADP source (free for commercial use, ATTRIBUTION REQUIRED on any
--     rendering surface). ADP is time-varying MARKET data, so it lives in its own
--     sim_player_pool snapshot table, SEPARATE from the editorial players table
--     (players = identity; pool = market). matched_player_id is the future join to
--     players (headshots / Sportsvyn-board mode) and stays NULL until the NFL
--     player ingestion schema pass lands.
--   · Draft-time provenance: a draft freezes which pool it ran against
--     (pool_snapshot_date/format/teams) and each pick freezes adp_at_pick, so a
--     draft graded Tuesday never regrades on Thursday's ADP.
--
-- FFC payload notes (recon): player_id (int -> stored as text), name, position
-- in FFC vocab (QB/RB/WR/TE/PK/DEF -> note PK=kicker, DEF=team defense), team,
-- adp, high (-> adp_high), low (-> adp_low), times_drafted. FFC also returns
-- stdev/bye/adp_formatted, NOT stored here (out of the v1 spec; add later if the
-- sim needs bye-week logic). No field forced a spec change.
--
-- Depends: users (FK target). Additive: no existing table is modified; WC and
-- gridiron rows are untouched. Reversible by DROP TABLE (reverse FK order).
-- FK style matches house convention: users("id") quoted, players(id) unquoted.
-- ============================================================================

-- ---- sim_player_pool: seasonal ADP snapshots (market data) ------------------
CREATE TABLE sim_player_pool (
  id                 serial PRIMARY KEY,
  snapshot_date      date        NOT NULL,
  scoring_format     text        NOT NULL CHECK (scoring_format IN ('ppr', 'half-ppr', 'standard', '2qb')),
  teams_count        integer     NOT NULL,
  ffc_player_id      text        NOT NULL,
  name               text        NOT NULL,
  position           text        NOT NULL,           -- FFC vocab: QB/RB/WR/TE/PK/DEF
  team               text,
  adp                numeric     NOT NULL,
  adp_high           numeric,                          -- FFC 'high'
  adp_low            numeric,                          -- FFC 'low'
  times_drafted      integer,
  matched_player_id  integer     REFERENCES players(id),  -- future headshot join; NULL this session
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, scoring_format, teams_count, ffc_player_id)
);

-- ---- draft_configs: presets (user_id NULL) + user-saved configs -------------
CREATE TABLE draft_configs (
  id                  serial PRIMARY KEY,
  user_id             integer     REFERENCES users("id") ON DELETE CASCADE,  -- NULL = system preset
  name                text,
  teams_count         integer,
  scoring_format      text        CHECK (scoring_format IN ('ppr', 'half-ppr', 'standard', '2qb')),
  roster_slots        jsonb       NOT NULL,
  pick_timer_seconds  integer,                         -- NULL = no timer
  is_preset           boolean     NOT NULL DEFAULT false,
  source              text        NOT NULL DEFAULT 'manual',
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ---- drafts: one draft run; freezes its pool provenance --------------------
CREATE TABLE drafts (
  id                   serial PRIMARY KEY,
  user_id              integer     NOT NULL REFERENCES users("id") ON DELETE CASCADE,
  config_id            integer     REFERENCES draft_configs(id),
  status               text        CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  pick_position        integer,
  is_auto              boolean     NOT NULL DEFAULT false,
  pool_snapshot_date   date        NOT NULL,
  pool_scoring_format  text        NOT NULL,
  pool_teams_count     integer     NOT NULL,
  started_at           timestamptz,
  completed_at         timestamptz
);

-- ---- draft_picks: the pick ledger; freezes adp_at_pick for grading ---------
CREATE TABLE draft_picks (
  id             serial PRIMARY KEY,
  draft_id       integer     REFERENCES drafts(id) ON DELETE CASCADE,
  round          integer,
  overall_pick   integer,
  roster_slot    text,
  ffc_player_id  text        NOT NULL,
  player_name    text,
  position       text,
  picked_by      text        CHECK (picked_by IN ('user', 'ai')),
  adp_at_pick    numeric,                              -- frozen for the value-vs-ADP ledger
  picked_at      timestamptz,
  UNIQUE (draft_id, overall_pick)
);

-- ---- indexes ----------------------------------------------------------------
CREATE INDEX idx_drafts_user_status       ON drafts(user_id, status);
CREATE INDEX idx_sim_player_pool_lookup   ON sim_player_pool(scoring_format, teams_count, snapshot_date);
CREATE INDEX idx_draft_picks_draft        ON draft_picks(draft_id);

-- ---- seed: the four launch presets (user_id NULL, is_preset true) -----------
-- roster_slots sum MUST equal 15 rounds (verified): standard slots
-- 1+2+2+1+1+1+1+6 = 15; 2QB slots 2+2+2+1+1+1+1+5 = 15. Roster vocab uses
-- K/DST (draft slots); FFC's PK/DEF map onto them at draft time.
INSERT INTO draft_configs (user_id, name, teams_count, scoring_format, roster_slots, pick_timer_seconds, is_preset, source) VALUES
  (NULL, 'Standard 12 PPR', 12, 'ppr',      '{"QB":1,"RB":2,"WR":2,"TE":1,"FLEX":1,"K":1,"DST":1,"BN":6}'::jsonb, 60,   true, 'preset'),
  (NULL, '10-Team Half',    10, 'half-ppr', '{"QB":1,"RB":2,"WR":2,"TE":1,"FLEX":1,"K":1,"DST":1,"BN":6}'::jsonb, 60,   true, 'preset'),
  (NULL, '8-Team Casual',    8, 'standard', '{"QB":1,"RB":2,"WR":2,"TE":1,"FLEX":1,"K":1,"DST":1,"BN":6}'::jsonb, NULL, true, 'preset'),
  (NULL, '12-Team 2QB',     12, '2qb',      '{"QB":2,"RB":2,"WR":2,"TE":1,"FLEX":1,"K":1,"DST":1,"BN":5}'::jsonb, 60,   true, 'preset');

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT count(*) FROM draft_configs WHERE is_preset;      -- expect 4
--   SELECT count(*) FROM sim_player_pool;                    -- expect 0 pre-snapshot
--   SELECT count(*) FROM drafts;  SELECT count(*) FROM draft_picks;  -- expect 0
--   -- roster slot sums:
--   SELECT name, (SELECT sum(value::int) FROM jsonb_each_text(roster_slots)) AS slots
--     FROM draft_configs WHERE is_preset;                    -- expect 15 each
-- ----------------------------------------------------------------------------
