-- ============================================================================
-- Migration 062 - gridiron game detail: scoring plays and player lines
-- ============================================================================
-- Backs /nfl/game/[slug]. Two per-game reads from API-Sports, STORED rather
-- than proxied, so the page is one server render against our own database and
-- a provider outage degrades a tab rather than a page.
--
-- WHY NOT match_events. That table is the SOCCER event stream: it carries
-- minute/minute_extra, team_side, assist_name, and an is_current flag driven by
-- the VAR-cancellation logic in syncMatchEvents. A gridiron scoring play has a
-- quarter rather than a minute, a prose description rather than a detail enum,
-- and a running score - and it is never retracted. Overloading the soccer table
-- would mean every soccer reader learning to skip football rows, and every
-- football reader learning to skip five columns that are always NULL.
--
-- WHAT THE PROVIDER ACTUALLY SERVES (probed 2026-08-11 against the finished
-- Hall of Fame game and a 2024 Week 1 control):
--   /games/events              SCORING PLAYS ONLY - TD and FG, no drives, no
--                              non-scoring snaps. Serves PRE and REG alike.
--   /games/statistics/players  Per-player lines in named groups. Serves PRE and
--                              REG alike. Every value is a STRING, including
--                              compounds like "15/19" and "1-2".
--   /games/statistics/teams    REG ONLY - returns zero rows for preseason. It
--                              gets no table here: a team box score is a flat
--                              set of totals that belongs in metadata jsonb
--                              alongside line_scores, and building a table for
--                              something the provider will not serve until
--                              Week 1 is building on a promise.
--
-- IDEMPOTENT BY DESIGN. Both tables key on the match plus a provider-stable
-- discriminator, so a re-fetch of a live game updates in place. A game that is
-- re-polled every few minutes must not accumulate twelve copies of the same
-- touchdown.
--
-- Reversible: DROP both tables. No existing row changes value.
-- ============================================================================

-- ---- scoring plays ---------------------------------------------------------
CREATE TABLE gridiron_game_events (
  id            serial PRIMARY KEY,
  match_id      integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  -- Ordinal within the game, assigned at ingest from the provider's array
  -- order. The provider gives no event id, and (quarter, clock) is not unique
  -- enough to key on - two scores can share a clock reading. Position in the
  -- returned sequence IS the identity, and it is stable because the sequence is
  -- chronological and append-only.
  seq           integer NOT NULL,
  quarter       integer NOT NULL,        -- 1-4, 5+ for overtime periods
  quarter_label text,                    -- the provider's word, kept verbatim
  clock         text,                    -- "14:55" as given; never parsed to a number
  team_id       integer REFERENCES teams(id),
  scoring_type  text NOT NULL,           -- 'TD' | 'FG' | whatever else appears
  player_name   text,
  -- The whole play in prose, which is the readable payload:
  -- "Simi Fehoko 5 Yd pass from Carson Beck (Chad Ryland Kick)"
  description   text,
  -- Running score AFTER the play. Stored rather than derived so the page never
  -- has to re-add the game to draw the spine.
  home_score    integer,
  away_score    integer,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, seq)
);

CREATE INDEX idx_gridiron_events_match ON gridiron_game_events (match_id, seq);

COMMENT ON TABLE gridiron_game_events IS 'Gridiron SCORING PLAYS from API-Sports /games/events. Scoring only - the provider serves no drives and no non-scoring plays. Separate from match_events, which is the soccer event stream with a different shape and a retraction flag.';
COMMENT ON COLUMN gridiron_game_events.seq IS 'Position in the provider''s chronological array. The provider issues no event id, and (quarter, clock) is not unique.';

-- ---- player lines ----------------------------------------------------------
CREATE TABLE gridiron_player_lines (
  id            serial PRIMARY KEY,
  match_id      integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id       integer REFERENCES teams(id),
  -- The provider's group name, normalised to lower_snake: passing, rushing,
  -- receiving, defensive, kicking, punting, fumbles, interceptions,
  -- kick_returns, punt_returns. Groups appear ONLY when something happened in
  -- them, so a page must never assume a fixed set.
  stat_group    text NOT NULL,
  provider_player_id integer,
  player_name   text NOT NULL,
  -- The stats verbatim, as the provider's { name, value } pairs collapsed to an
  -- object. Values stay STRINGS here - "15/19", "1-2", "26:17" and "188" all
  -- arrive as text, and normalising them into typed columns would mean inventing
  -- a schema for ten groups that each carry a different set of keys.
  stats         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The provider's label order, kept alongside the object because JSONB DOES
  -- NOT PRESERVE IT. Postgres stores object keys sorted by length then bytes,
  -- so reading Object.keys(stats) back gives "ff, tfl, sacks, qb hts, tackles"
  -- where the provider sent "tackles, unassisted tackles, sacks, tfl...". For
  -- the four designed groups the column order is in the page and this does not
  -- matter; for defence, returns and punting the page renders what it is given,
  -- and what it is given should be the box score's order rather than an
  -- artefact of the storage engine.
  stat_order    text[] NOT NULL DEFAULT '{}',
  -- The PARSED subset the fantasy scorer needs, typed. Written at ingest so the
  -- page does not re-parse "15/19" on every render, and so lib/fantasy/scoring
  -- is fed the same structured shape the sim feeds it - one methodology.
  parsed        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, team_id, stat_group, player_name)
);

CREATE INDEX idx_gridiron_lines_match ON gridiron_player_lines (match_id, stat_group);

COMMENT ON TABLE gridiron_player_lines IS 'Per-player game lines from API-Sports /games/statistics/players. `stats` is the provider payload with string values; `parsed` is the typed subset lib/fantasy/scoring.js consumes, so fantasy points come from the same module the sim uses.';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('gridiron_game_events','gridiron_player_lines');
--   -- expect both.
-- ----------------------------------------------------------------------------
