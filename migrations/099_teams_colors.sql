-- 099: team colors. Two hex strings with the '#', nullable: a team without
-- them renders no helmet. NFL from nflverse teams_colors_logos (CC-BY-4.0),
-- CFB from the CFBD /teams call the weekly sync already makes.
ALTER TABLE teams ADD COLUMN IF NOT EXISTS color_primary text;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS color_secondary text;
COMMENT ON COLUMN teams.color_primary IS 'Hex with the # (e.g. #97233F). NULL when the provider has none - the helmet is then not drawn.';
COMMENT ON COLUMN teams.color_secondary IS 'Hex with the #. Facemask and stripe. NULL when the provider has none.';
