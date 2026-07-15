-- ============================================================================
-- Migration 044 — NFL/CFB gridiron schema extension
-- ============================================================================
-- Purpose: Additive extension so the same `matches`/`teams` tables can carry
--          NFL + College Football (SportsData.io) alongside soccer, per
--          ~/scratch/sportsdata-spike/SCHEMA-PROPOSAL.md §8. Transcription only
--          — every decision is justified in that doc, not re-derived here.
-- Depends: 003_leagues, 004_teams, 006_matches, 017_team_player_denormalization.
--
-- Schema notes:
--   · ADDITIVE ONLY. All new `matches`/`teams` columns are nullable with no
--     default, so existing World Cup rows are untouched and every WC surface
--     stays byte-identical (readers that don't select these columns are
--     unaffected). No soccer column (stage, group_code, home/away_penalties,
--     confederation, group_code, tournament_*) is modified.
--   · Reversible: DROP the new columns / DROP TABLE team_season_membership /
--     DROP the new indexes. No data backfill is performed here; no existing
--     row changes value.
--   · No change to `matches.status` CHECK — the SportsData status map
--     (Final/'F/OT' -> final, Canceled -> cancelled; live-tier enums TBD) lands
--     inside the existing allowed set (scheduled|live|final|postponed|cancelled).
--     Status mapping is an ingest-code concern (SCHEMA-PROPOSAL §6b).
--   · No `leagues` change. The single stable `nfl` and `cfb` league rows
--     (sport='football', season_type='season-and-postseason') are seeded by
--     application bootstrap, per the 003 convention — NOT inserted here.
--   · Season lives on the MATCH (single multi-season league row per sport):
--     season_year + season_phase + week. season_phase is the canonical
--     'REG'|'PRE'|'POST' (mapped at ingest from ApiSeason's suffix; numeric
--     SeasonType is the fallback — SCHEMA-PROPOSAL §3a). Named `season_phase`,
--     NOT `season_type`, to avoid confusion with leagues.season_type (which is
--     the kind-of-competition, a different vocabulary).
--   · season_label (e.g. '2025REG') is DERIVED at read-time from
--     season_year || season_phase. It is intentionally NOT stored — no column
--     here — to avoid backfill drift (SCHEMA-PROPOSAL §3b).
--   · SportsData ids live in the existing `external_ids` jsonb (no DDL): team
--     -> sportsdata_team_id, player -> sportsdata_player_id, game -> per-sport
--     sportsdata_score_id (NFL) / sportsdata_game_id (CFB). All provider
--     lookups MUST be league_id-scoped (SCHEMA-PROPOSAL §5).
--   · team_season_membership is the SOURCE OF TRUTH for conference/division
--     (CFB realignment is season-dependent — the record-multiplier reads
--     membership by (team_id, season_year)). teams.current_conference /
--     current_division are DERIVED denorm (current season only), refreshed
--     from team_season_membership — same pattern as 017's current_* columns.
-- ============================================================================

-- ---- matches: gridiron season/week (additive, NULL for soccer) -------------
ALTER TABLE matches
  ADD COLUMN season_year  integer,
  ADD COLUMN season_phase text
    CHECK (season_phase IN ('REG', 'PRE', 'POST')),
  ADD COLUMN week         integer;

COMMENT ON COLUMN matches.season_year  IS 'SportsData Season (e.g. 2025). NULL for soccer/tournament leagues (WC uses leagues.season_year).';
COMMENT ON COLUMN matches.season_phase IS 'Gridiron season phase: REG|PRE|POST (canonical). NULL for soccer. Mapped at ingest from SportsData ApiSeason suffix; NOT the same as leagues.season_type. OFF/all-star games are skipped at ingest, not stored.';
COMMENT ON COLUMN matches.week         IS 'SportsData Week (integer). NULL for soccer. Scopes with (league_id, season_year, season_phase).';

-- Per-sport SportsData game id (asymmetric: NFL ScoreID vs CFB GameID), unique
-- within a league. Partial so soccer rows (no such key) are excluded.
CREATE UNIQUE INDEX idx_matches_sd_score_id
  ON matches (league_id, (external_ids->>'sportsdata_score_id'))
  WHERE external_ids ? 'sportsdata_score_id';

CREATE UNIQUE INDEX idx_matches_sd_game_id
  ON matches (league_id, (external_ids->>'sportsdata_game_id'))
  WHERE external_ids ? 'sportsdata_game_id';

-- Gridiron week reads (schedule, weekly boards).
CREATE INDEX idx_matches_gridiron_week
  ON matches (league_id, season_year, season_phase, week)
  WHERE week IS NOT NULL;

-- ---- team_season_membership: conference/division, season-accurate ----------
CREATE TABLE team_season_membership (
  id                    serial PRIMARY KEY,
  league_id             integer NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id               integer NOT NULL REFERENCES teams(id)   ON DELETE CASCADE,
  season_year           integer NOT NULL,
  conference            text,                 -- 'AFC'/'NFC' (NFL) | 'American'/'SEC'/... (CFB)
  division              text,                 -- 'West' (NFL) | DivisionName/NULL (CFB)
  conference_source_id  text,                 -- SportsData ConferenceID (string), provenance
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (league_id, team_id, season_year)
);

CREATE INDEX idx_team_season_membership_lookup
  ON team_season_membership (league_id, season_year);

COMMENT ON TABLE team_season_membership IS 'Source of truth for a team''s conference/division in a given season. Handles CFB realignment (membership changes season-to-season) and repeats stably for NFL. One upsert set per season from SportsData LeagueHierarchy.';
COMMENT ON COLUMN team_season_membership.division IS 'NFL division (North/South/East/West). CFB: SportsData DivisionName, often NULL. Distinct from soccer teams.group_code.';

-- ---- teams: derived current-season denorm (additive, NULL for soccer) ------
ALTER TABLE teams
  ADD COLUMN current_conference text,
  ADD COLUMN current_division   text;

COMMENT ON COLUMN teams.current_conference IS 'DERIVED denorm from team_season_membership for the CURRENT season (refreshed on membership change; same philosophy as 017 current_* columns). NULL for soccer — use confederation for that.';
COMMENT ON COLUMN teams.current_division   IS 'DERIVED denorm from team_season_membership (current season). NULL for soccer.';

-- ----------------------------------------------------------------------------
-- Sanity check (run after applying):
--   -- Existing WC rows unaffected: every new column NULL, no membership rows.
--   SELECT count(*) FILTER (WHERE season_year IS NULL) AS wc_untouched,
--          count(*) FILTER (WHERE season_year IS NOT NULL) AS gridiron
--     FROM matches;                                  -- expect gridiron = 0 pre-ingest
--   SELECT count(*) FROM team_season_membership;     -- expect 0 pre-ingest
--   -- Column existence + soccer-safety:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='matches' AND column_name IN ('season_year','season_phase','week');
--   -- Derived label (never stored) at read time, e.g.:
--   --   SELECT (season_year::text || season_phase) AS season_label FROM matches
--   --    WHERE week IS NOT NULL LIMIT 1;             -- -> '2025REG'
-- ----------------------------------------------------------------------------
