-- 113_plays_pitches.sql — the two fields a PITCH has that a play does not.
--
-- WHY NOW. The Plays tab is pitch-by-pitch: each at-bat's rows read "1: 94
-- four-seam · ball", "2: 88 slider · swinging strike". Migration 111 added the
-- six baseball columns a PLAY knows - the half, the outs, the count, the batter
-- and the pitcher - and stopped there, because nothing was reading pitches yet.
-- The provider has them on every play row and has all along:
--
--   GET /mlb/v1/plays?game_id=5060116
--   -> { ..., pitch_type: "Four-Seam Fastball", pitch_velocity: 94,
--          hit_coordinate_x, hit_coordinate_y, trajectory }
--
-- TWO COLUMNS, NOT FIVE. pitch_type and pitch_velocity are what the tab prints.
-- The hit coordinates and the trajectory are a spray chart nobody has asked for
-- and would be three more nulls on every football row for a surface that does
-- not exist; they stay in the provider's payload until something reads them.
--
-- VELOCITY IS NUMERIC, NOT INTEGER. The feed sends 94 today and 94.3 is the
-- same fact measured better; an integer column would silently truncate the day
-- that changes. NUMERIC(4,1) holds 0.0-999.9, which covers every pitch ever
-- thrown and refuses a value that is not a speed.
--
-- NO DEFAULTS, for migration 111's reason: a pitch with no velocity is a pitch
-- the provider did not measure, and 0 would be a 0mph pitch.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS throughout.

ALTER TABLE plays
  ADD COLUMN IF NOT EXISTS pitch_type     TEXT,
  ADD COLUMN IF NOT EXISTS pitch_velocity NUMERIC(4,1);

COMMENT ON COLUMN plays.pitch_type IS
  'Baseball only: the provider''s own pitch name ("Four-Seam Fastball", "Slider"), as text and unnormalised - the tab prints it and nothing compares it. NULL on a play row that is not a pitch (an inning marker, a substitution) and on every football row.';

COMMENT ON COLUMN plays.pitch_velocity IS
  'Baseball only: release speed in mph. NUMERIC, not INTEGER - the feed sends 94 today and 94.3 is the same fact measured better. NO DEFAULT: a pitch with no velocity was not measured, and 0 would be a 0mph pitch.';

-- THE TAB READS ONE GAME'S PITCHES IN ORDER, newest half first, and groups by
-- (period, inning_type). plays_match_inning_idx (migration 111) already covers
-- that read; this partial index is for the pitch rows alone, which are the only
-- rows the tab draws beneath an at-bat.
CREATE INDEX IF NOT EXISTS plays_match_pitch_idx
  ON plays (match_id, play_number) WHERE pitch_type IS NOT NULL;
