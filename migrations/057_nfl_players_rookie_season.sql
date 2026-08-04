-- ============================================================================
-- Migration 057 — nfl_players.rookie_season
-- ============================================================================
-- The fantasy movement board (/nfl/fantasy) shows an R chip and offers a Class
-- filter. Neither has a source today:
--
--   · nfl_players carries no draft year, no rookie season, no experience
--     (13 columns: id, bdl_player_id, names, position, team_id,
--      is_team_defense, jersey_number, timestamps)
--   · BDL returns experience as a DISPLAY STRING - "Rookie", "1st Season",
--     "2nd Season", "11th Season" - not a draft year and not an integer
--
-- So the flag is stored, not derived. rookie_season is the season a player
-- entered the league, as an integer year. The board reads:
--
--     Rookies  = rookie_season = <current season>
--     Veterans = rookie_season IS NULL OR rookie_season < <current season>
--
-- NULL MEANS "WE HAVE NOT ESTABLISHED IT", NOT "VETERAN". The read above sorts
-- NULL into Veterans deliberately: a player we have not classified must not
-- appear under an R chip on the strength of an absent value. Absence over
-- inference - the same rule the board's gated columns follow.
--
-- SEEDED BY HAND (scripts/seed-rookie-flags.mjs), not parsed from BDL's
-- experience string. The string's shape is being logged first so we learn what
-- it actually contains across a full season before anything depends on it -
-- "Rookie" and "1st Season" already both appear, for players of different ages,
-- which is exactly the kind of ambiguity that should not silently drive a flag.
--
-- Additive + reversible:
--   ALTER TABLE nfl_players DROP COLUMN rookie_season;
-- Depends: 049 (nfl_players).
-- ============================================================================

ALTER TABLE nfl_players
  ADD COLUMN rookie_season integer NULL;

COMMENT ON COLUMN nfl_players.rookie_season IS
  'Season the player entered the league (integer year). NULL = not established, which the board reads as Veteran. Seeded by hand; never parsed from BDL experience strings.';
