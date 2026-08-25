-- 074_plays.sql - play-by-play, the DriveStrip's substrate.
--
-- ONE ROW PER PLAY, PROVIDER-NEUTRAL. CFBD and BDL disagree about almost
-- everything at the wire (see lib/gridiron/plays.js for the two traps), so the
-- normalisation happens in the importer and this table stores only the settled
-- facts. Nothing here is provider-shaped.
--
-- THE FIELD-POSITION CONTRACT. yards_to_goal is the distance from the LINE OF
-- SCRIMMAGE to the DEFENSE'S end zone, 0-100, always from the offense's point
-- of view. Both providers publish exactly this (CFBD yardsToGoal, BDL
-- start_yards_to_endzone), and it is the only positional field that means the
-- same thing in both codes - absolute yard lines do NOT (CFBD counts from the
-- offense's own goal, BDL from the home team's). Absolute placement is derived
-- at render time from yards_to_goal + offense_team_id; storing a derived
-- absolute here would bake one provider's frame into the table.
--
-- drive_id is a STRING and deliberately not a foreign key: CFBD hands us its
-- own native drive id, and the NFL path has none and gets a reconstructed one.
-- A drives table would have to pick a winner between those two; a stable
-- grouping key does not.

CREATE TABLE IF NOT EXISTS plays (
  id                BIGSERIAL PRIMARY KEY,
  match_id          INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,

  -- The provider's own id for this play. Idempotence rides on it: a re-import
  -- of a game already held must correct rows, never duplicate them.
  provider_play_id  TEXT NOT NULL,

  -- CFBD: the native driveId. NFL: reconstructed (see reconstructDrives).
  -- Null only for administrative rows that belong to no drive at all.
  drive_id          TEXT,
  drive_number      INTEGER,
  play_number       INTEGER,

  period            INTEGER,
  clock             TEXT,            -- "12:41" exactly as the provider states it, never re-derived

  down              INTEGER,         -- null on kickoffs, timeouts, period markers
  distance          INTEGER,
  yards_to_goal     INTEGER,         -- see the field-position contract above
  yards_gained      INTEGER,

  offense_team_id   INTEGER REFERENCES teams(id),
  play_type         TEXT,
  text              TEXT,

  -- Score AFTER the play, as the provider states it.
  home_score        INTEGER,
  away_score        INTEGER,
  scoring           BOOLEAN NOT NULL DEFAULT false,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT plays_match_provider_play_uniq UNIQUE (match_id, provider_play_id)
);

-- The read the gamecast actually issues: every play of one game, in order.
CREATE INDEX IF NOT EXISTS plays_match_order_idx
  ON plays (match_id, period, play_number);

-- The drive chart groups by drive within a game.
CREATE INDEX IF NOT EXISTS plays_match_drive_idx
  ON plays (match_id, drive_id);
