-- ============================================================================
-- Migration 080 — cfb_live_player_lines: the live box score, and only the live one
-- ============================================================================
-- SOURCE PER GAME STATE. This table holds a SECOND provider's view of a game
-- that is still being played, because the provider we already pay for does not
-- publish one: CFBD's /games/players returns nothing at all for an
-- in_progress game and lands roughly 35 minutes after the final. The other
-- feed advances mid-game — measured 30 Aug 2026 across a second-half kickoff,
-- 8 of 53 rows moved and 2 new rows appeared, with the team TD totals
-- reconciling exactly to the scoreboard at both sample points.
--
-- IT IS EPHEMERAL BY DESIGN, and that is the whole reason it is a separate
-- table rather than more columns on cfb_player_game_stats:
--   · rows for a match stop being written the moment our status leaves 'live'
--   · the reader stops reading them at the same moment (relay 2)
--   · CFBD's complete import then owns that game forever
-- The two are NEVER blended and never share a row. A live line here and a
-- final line there can disagree — they are different providers counting a
-- different moment — and reconciling them into one row would produce a number
-- neither source ever published.
--
-- ROWS ARE NOT DELETED AT FINAL. During CFBD's publication lag the last live
-- snapshot is the freshest true thing we hold, so it stays until the complete
-- import supersedes it. Deleting on the status flip would blank the box score
-- for half an hour.
--
-- COVERAGE IS NARROWER THAN CFBD'S, ON PURPOSE AND ON RECORD. The live feed
-- carries passing / rushing / receiving / defense and NOTHING ELSE — no
-- kicking, punting, returns or fumbles. Four groups where the complete import
-- ships ten. Relay 2's reader must show the four and not pretend the other six
-- are empty.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cfb_live_player_lines (
  id                      bigserial PRIMARY KEY,
  match_id                integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,

  -- THE PROVIDER'S OWN ID SPACE. It is not cfbd_player_id and there is no
  -- cross-reference field on either side; the identity below is what lets a
  -- reader render a name without a join, and what a later reconciliation
  -- would match on.
  bdl_player_id           integer NOT NULL,

  -- IDENTITY AS DELIVERED. The live feed hands these over free on every row —
  -- position and jersey included, which CFBD's box score does NOT give us.
  -- Stored rather than re-derived: re-deriving would mean a join to players
  -- on every render, for fields the payload already contains.
  first_name              text,
  last_name               text,
  position                text,
  jersey_number           text,

  -- Team resolved on our side via the college-name map (99.6% on a normalised
  -- `college` match). team_id may be NULL when resolution fails: a line with a
  -- name and numbers is still worth showing, and a wrong team is worse than an
  -- absent one.
  team_id                 integer REFERENCES teams(id) ON DELETE SET NULL,
  team_name               text,

  -- THE NINETEEN MAPPED COLUMNS. Deliberately the SAME NAMES
  -- cfb_player_game_stats uses, so relay 2's reader can swap sources without
  -- swapping vocabulary. Two dialects, mapped once, at the boundary.
  pass_cmp                integer,
  pass_att                integer,
  pass_yds                integer,
  pass_td                 integer,
  pass_int                integer,
  rush_car                integer,
  rush_yds                integer,
  rush_td                 integer,
  rush_long               integer,
  rec                     integer,
  rec_yds                 integer,
  rec_td                  integer,
  rec_long                integer,
  -- numeric, not integer: college tackle and TFL counts carry halves (2.5).
  tackles_tot             numeric(5,1),
  tackles_solo            numeric(5,1),
  tfl                     numeric(5,1),
  sacks                   numeric(5,1),
  def_int                 integer,
  pass_def                integer,

  -- THREE FIELDS THE LIVE FEED HAS AND THE COMPLETE ONE DOES NOT. Cheap to
  -- keep, and they have no home in cfb_player_game_stats — another reason
  -- these are two tables.
  pass_qbr                numeric(6,2),
  pass_rating             numeric(6,2),
  rec_targets             integer,

  data_provider_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- The upsert target. One row per player per match; a tick rewrites it in place
-- so the table never grows with time, only with players.
CREATE UNIQUE INDEX IF NOT EXISTS cfb_live_player_lines_uniq
  ON cfb_live_player_lines (match_id, bdl_player_id);

CREATE INDEX IF NOT EXISTS cfb_live_player_lines_match
  ON cfb_live_player_lines (match_id, team_id);

COMMENT ON TABLE cfb_live_player_lines IS
  'EPHEMERAL live box score from the secondary feed. Written only while matches.status = live; superseded by cfb_player_game_stats once the complete import lands. Never blended with it — see migration 080 header.';
COMMENT ON COLUMN cfb_live_player_lines.bdl_player_id IS
  'The live feed''s own player id space. Not cfbd_player_id; no cross-reference exists on either side.';
COMMENT ON COLUMN cfb_live_player_lines.team_id IS
  'Nullable. Resolved by normalised college name; a failed resolution keeps the line with team_name only rather than attaching it to the wrong club.';
