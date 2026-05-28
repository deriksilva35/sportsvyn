-- ============================================================================
-- seed_argentina_dev.sql  —  DEV SEED, NOT A SCHEMA MIGRATION
-- ============================================================================
-- Purpose: Populate a single hypothetical World Cup 2026 slice so /team/argentina
--          renders against the locked team-argentina-v2 design. ALL DATA IS FAKE.
--          The tournament has not been played; this depicts a hypothetical
--          mid-tournament state (group stage complete, into the Round of 16)
--          purely so every section of the page has something to render.
--
-- THROWAWAY: delete with teardown_argentina_dev.sql. Wiped when real data sync
--            comes online. The seed_/teardown_ prefix marks this as NOT part of
--            the numbered 001-017 schema sequence.
--
-- RE-RUNNABLE: the resets at the top clear any prior run before re-inserting.
-- FK strategy: rows are referenced by slug/tag subqueries, never hardcoded ids.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Idempotent reset (safe to re-run)
-- ---------------------------------------------------------------------------
-- Deleting the league cascades to teams, matches, tournament stats, rankings,
-- odds, broadcasters, and the team_outlook blurb. Players are not league-scoped,
-- so they carry a metadata seed tag and are cleared explicitly.
DELETE FROM players WHERE metadata->>'seed' = 'argentina_dev';
DELETE FROM leagues WHERE slug = 'fifa-wc-2026';

-- ---------------------------------------------------------------------------
-- 1. League
-- ---------------------------------------------------------------------------
INSERT INTO leagues (slug, name, short_name, sport, season_type, season_year, metadata)
VALUES (
  'fifa-wc-2026', '2026 FIFA World Cup', 'World Cup', 'soccer', 'tournament', 2026,
  '{"hosts": ["USA", "Canada", "Mexico"], "format": "48-team", "seed": "argentina_dev"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- 2. Teams  (Argentina fully denormalized; opponents minimal)
-- ---------------------------------------------------------------------------
-- Argentina — current_outlook_blurb_id is set later (chicken/egg with blurb).
INSERT INTO teams (
  league_id, slug, name, short_name, abbreviation,
  confederation, coach_name, fifa_rank, group_code,
  current_power_rank, current_power_score, current_rank_movement,
  tournament_wins, tournament_draws, tournament_losses,
  tournament_goals_for, tournament_goals_against,
  flag_color_primary, flag_svg_path, metadata
) VALUES (
  (SELECT id FROM leagues WHERE slug = 'fifa-wc-2026'),
  'argentina', 'Argentina', 'Argentina', 'ARG',
  'CONMEBOL', 'Lionel Scaloni', 1, 'C',
  2, 8.70, 1,
  2, 1, 0,
  6, 2,
  '#75AADB', 'https://blob.sportsvyn.com/flags/argentina.svg',
  '{"city": "Buenos Aires", "seed": "argentina_dev"}'::jsonb
);

-- Group C opponents + Round-of-16 opponent (minimal rows, FK targets only)
INSERT INTO teams (league_id, slug, name, short_name, abbreviation, confederation, flag_color_primary, metadata)
VALUES
  ((SELECT id FROM leagues WHERE slug='fifa-wc-2026'), 'australia', 'Australia', 'Australia', 'AUS', 'AFC',     '#FFCD00', '{"seed":"argentina_dev"}'::jsonb),
  ((SELECT id FROM leagues WHERE slug='fifa-wc-2026'), 'nigeria',   'Nigeria',   'Nigeria',   'NGA', 'CAF',     '#008751', '{"seed":"argentina_dev"}'::jsonb),
  ((SELECT id FROM leagues WHERE slug='fifa-wc-2026'), 'croatia',   'Croatia',   'Croatia',   'CRO', 'UEFA',    '#FF0000', '{"seed":"argentina_dev"}'::jsonb),
  ((SELECT id FROM leagues WHERE slug='fifa-wc-2026'), 'mexico',    'Mexico',    'Mexico',    'MEX', 'CONCACAF','#006847', '{"seed":"argentina_dev"}'::jsonb);

-- ---------------------------------------------------------------------------
-- 3. Players  (Argentina squad — real names so the page reads true while testing)
-- ---------------------------------------------------------------------------
INSERT INTO players (
  slug, full_name, known_as, position, nationality,
  current_team_id, birthdate,
  current_composite_rank, current_composite_score, current_rank_movement,
  current_team_jersey_number, height_cm, preferred_foot,
  club_name, international_caps, international_goals,
  photo_url_treated, tournament_goals, tournament_assists, metadata
)
SELECT
  v.slug, v.full_name, v.known_as, v.position, 'Argentina',
  (SELECT id FROM teams WHERE slug='argentina'), v.birthdate,
  v.crank, v.cscore, v.cmov,
  v.jersey, v.height, v.foot,
  v.club, v.caps, v.intl_goals,
  'https://blob.sportsvyn.com/players/' || v.slug || '-duotone.webp',
  v.t_goals, v.t_assists,
  '{"seed":"argentina_dev"}'::jsonb
FROM (VALUES
  --  slug                full_name             known_as     pos   birthdate     crank cscore cmov jersey height foot     club                  caps intl_g t_goals t_assists
  ('lionel-messi',      'Lionel Messi',       'Messi',      'RW', DATE '1987-06-24',  1, 9.10,  0, 10, 170, 'left',  'Inter Miami CF',       191, 112,  2, 2),
  ('julian-alvarez',    'Julián Álvarez',     'Álvarez',    'CF', DATE '2000-01-31',  4, 8.40,  2,  9, 170, 'right', 'Atlético Madrid',       45,  12,  2, 0),
  ('lautaro-martinez',  'Lautaro Martínez',   'Lautaro',    'CF', DATE '1997-08-22',  9, 8.00, -1, 22, 174, 'right', 'Inter',                 71,  33,  1, 1),
  ('alexis-mac-allister','Alexis Mac Allister','Mac Allister','CM',DATE '1998-12-24', 12, 7.90,  3, 20, 174, 'right', 'Liverpool',             40,   5,  1, 0),
  ('enzo-fernandez',    'Enzo Fernández',     'Enzo',       'CM', DATE '2001-01-17', 15, 7.80,  1, 24, 178, 'right', 'Chelsea',               42,   4,  0, 2),
  ('rodrigo-de-paul',   'Rodrigo De Paul',    'De Paul',    'CM', DATE '1994-05-24', 21, 7.50,  0,  7, 180, 'right', 'Atlético Madrid',       72,   3,  0, 1),
  ('cristian-romero',   'Cristian Romero',    'Romero',     'CB', DATE '1998-04-27', 18, 7.70, -2, 13, 185, 'right', 'Tottenham Hotspur',     45,   2,  0, 0),
  ('lisandro-martinez', 'Lisandro Martínez',  'Lisandro',   'CB', DATE '1998-01-18', 24, 7.40,  0, 25, 175, 'left',  'Manchester United',     34,   1,  0, 0),
  ('nicolas-otamendi',  'Nicolás Otamendi',   'Otamendi',   'CB', DATE '1988-02-12', 30, 7.10,  0, 19, 183, 'right', 'Benfica',              122,   5,  0, 0),
  ('nahuel-molina',     'Nahuel Molina',      'Molina',     'RB', DATE '1998-04-06', 36, 6.90,  1, 26, 175, 'right', 'Atlético Madrid',       44,   3,  0, 0),
  ('nicolas-tagliafico','Nicolás Tagliafico', 'Tagliafico', 'LB', DATE '1992-08-31', 40, 6.80, -1,  3, 172, 'left',  'Olympique Lyonnais',    66,   1,  0, 0),
  ('emiliano-martinez', 'Emiliano Martínez',  'E. Martínez','GK', DATE '1992-09-02',  6, 8.20,  4, 23, 195, 'right', 'Aston Villa',           48,   0,  0, 0),
  ('giuliano-simeone',  'Giuliano Simeone',   'Simeone',    'RW', DATE '2002-12-18', 55, 6.40,  0, 14, 178, 'left',  'Atlético Madrid',        6,   1,  0, 0)
) AS v(slug, full_name, known_as, position, birthdate, crank, cscore, cmov, jersey, height, foot, club, caps, intl_goals, t_goals, t_assists);

-- ---------------------------------------------------------------------------
-- 4. Matches  (3 group finals + 1 scheduled Round of 16)
-- ---------------------------------------------------------------------------
INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, home_score, away_score, stage, group_code, venue)
VALUES
  ((SELECT id FROM leagues WHERE slug='fifa-wc-2026'), 'argentina-vs-australia-2026-06-13',
    (SELECT id FROM teams WHERE slug='argentina'), (SELECT id FROM teams WHERE slug='australia'),
    TIMESTAMPTZ '2026-06-13 18:00-04', 'final', 2, 0, 'group', 'C', 'MetLife Stadium'),
  ((SELECT id FROM leagues WHERE slug='fifa-wc-2026'), 'argentina-vs-nigeria-2026-06-19',
    (SELECT id FROM teams WHERE slug='argentina'), (SELECT id FROM teams WHERE slug='nigeria'),
    TIMESTAMPTZ '2026-06-19 21:00-04', 'final', 1, 1, 'group', 'C', 'Mercedes-Benz Stadium'),
  ((SELECT id FROM leagues WHERE slug='fifa-wc-2026'), 'argentina-vs-croatia-2026-06-25',
    (SELECT id FROM teams WHERE slug='argentina'), (SELECT id FROM teams WHERE slug='croatia'),
    TIMESTAMPTZ '2026-06-25 18:00-04', 'final', 3, 1, 'group', 'C', 'AT&T Stadium'),
  ((SELECT id FROM leagues WHERE slug='fifa-wc-2026'), 'argentina-vs-mexico-2026-06-30',
    (SELECT id FROM teams WHERE slug='argentina'), (SELECT id FROM teams WHERE slug='mexico'),
    TIMESTAMPTZ '2026-06-30 20:00-04', 'scheduled', NULL, NULL, 'round_of_16', NULL, 'Estadio Azteca');

-- ---------------------------------------------------------------------------
-- 5. Team tournament stats  (Stats grid — note xG BELOW goals: "flattered the scoreline")
-- ---------------------------------------------------------------------------
INSERT INTO team_tournament_stats (
  team_id, league_id, matches_played, wins, draws, losses,
  goals_for, goals_against, goal_differential, clean_sheets,
  xg, xga, xgd, possession_pct, pass_completion_pct, shots, shots_on_target,
  rank_goals_for, rank_xg, rank_possession
) VALUES (
  (SELECT id FROM teams WHERE slug='argentina'),
  (SELECT id FROM leagues WHERE slug='fifa-wc-2026'),
  3, 2, 1, 0,
  6, 2, 4, 1,
  4.40, 3.20, 1.20, 58.50, 87.30, 41, 18,
  3, 11, 5
);

-- ---------------------------------------------------------------------------
-- 6. Player tournament stats  (Top Players cards + squad reads)
-- ---------------------------------------------------------------------------
INSERT INTO player_tournament_stats (
  player_id, league_id, team_id,
  matches_played, starts, minutes_played, goals, assists,
  xg, xa, composite_score, rank_composite
)
SELECT
  (SELECT id FROM players WHERE slug = v.slug),
  (SELECT id FROM leagues WHERE slug='fifa-wc-2026'),
  (SELECT id FROM teams WHERE slug='argentina'),
  v.mp, v.starts, v.mins, v.goals, v.assists, v.xg, v.xa, v.comp, v.rank
FROM (VALUES
  ('lionel-messi',       3, 3, 261, 2, 2, 1.80, 1.60, 9.1,  1),
  ('julian-alvarez',     3, 3, 248, 2, 0, 1.90, 0.40, 8.4,  4),
  ('lautaro-martinez',   3, 2, 176, 1, 1, 1.40, 0.70, 8.0,  9),
  ('alexis-mac-allister',3, 3, 270, 1, 0, 0.60, 0.50, 7.9, 12),
  ('enzo-fernandez',     3, 3, 264, 0, 2, 0.30, 1.10, 7.8, 15),
  ('rodrigo-de-paul',    3, 3, 255, 0, 1, 0.20, 0.60, 7.5, 21),
  ('cristian-romero',    3, 3, 270, 0, 0, 0.30, 0.10, 7.7, 18),
  ('lisandro-martinez',  3, 3, 270, 0, 0, 0.10, 0.00, 7.4, 24),
  ('nicolas-otamendi',   2, 2, 180, 0, 0, 0.10, 0.00, 7.1, 30),
  ('nahuel-molina',      3, 3, 261, 0, 0, 0.20, 0.30, 6.9, 36),
  ('nicolas-tagliafico', 3, 3, 270, 0, 0, 0.10, 0.20, 6.8, 40),
  ('emiliano-martinez',  3, 3, 270, 0, 0, 0.00, 0.00, 8.2,  6),
  ('giuliano-simeone',   2, 0,  41, 0, 0, 0.30, 0.20, 6.4, 55)
) AS v(slug, mp, starts, mins, goals, assists, xg, xa, comp, rank);

-- ---------------------------------------------------------------------------
-- 7. Editorial blurb  (the LOCKED, hand-written team_outlook — voice v1.0, manual)
-- ---------------------------------------------------------------------------
INSERT INTO editorial_blurbs (
  blurb_type, team_id, body, voice_model_version,
  generation_tier, status, is_current, auto_published,
  reviewed_by, published_at
) VALUES (
  'team_outlook',
  (SELECT id FROM teams WHERE slug='argentina'),
  'Argentina arrives in the Round of 16 with the group won and the questions intact. Three matches, seven points, top of the table. The results describe a side in control. The underlying numbers describe something quieter, an xG share that flattered the scoreline more than once, two of three wins built on a single decisive moment rather than ninety minutes of accumulated pressure. Scaloni''s team is still organized, still hard to play through, still able to find the goal a match asks for. It has not yet been made to defend a lead under real duress.

That test is what the knockouts are. The bracket does not reward a side riding a thin margin, and Argentina''s path narrows sharply from here. The case for them has not changed since 2022. A midfield that sets tempo, a back line that keeps its shape, and Messi, thirty-nine now and still the player a tournament organizes itself around, still bending the decisive minutes toward himself. The case against is whether that core has another four matches of this in its legs. The group stage settled which teams survive. From here the question is the harder one.',
  '1.0',
  'manual', 'editor_approved', true, false,
  'derik', now()
);

-- Wire the blurb back onto the team row (resolves the chicken/egg)
UPDATE teams
SET current_outlook_blurb_id = (
  SELECT id FROM editorial_blurbs
  WHERE blurb_type = 'team_outlook'
    AND team_id = (SELECT id FROM teams WHERE slug='argentina')
    AND is_current = true
)
WHERE slug = 'argentina';

-- ---------------------------------------------------------------------------
-- 8. Odds  (v2 Odds tiles: Tournament Winner futures + Next Match)
-- ---------------------------------------------------------------------------
INSERT INTO odds_markets (
  market_scope, market_type, league_id, team_id,
  selection_label, american_odds, implied_probability, decimal_odds,
  source_books, num_books, consensus_method,
  previous_american_odds, previous_implied_prob, movement_24h_odds, movement_24h_prob,
  is_current
) VALUES (
  'futures', 'tournament_winner',
  (SELECT id FROM leagues WHERE slug='fifa-wc-2026'),
  (SELECT id FROM teams WHERE slug='argentina'),
  'Argentina to win 2026 World Cup', 450, 18.18, 5.500,
  ARRAY['DraftKings','FanDuel','BetMGM'], 3, 'mean',
  500, 16.67, -50, 1.51,
  true
);

INSERT INTO odds_markets (
  market_scope, market_type, match_id, team_id,
  selection_label, american_odds, implied_probability, decimal_odds,
  source_books, num_books, consensus_method,
  previous_american_odds, previous_implied_prob, movement_24h_odds, movement_24h_prob,
  is_current
) VALUES (
  'match', 'match_winner',
  (SELECT id FROM matches WHERE slug='argentina-vs-mexico-2026-06-30'),
  (SELECT id FROM teams WHERE slug='argentina'),
  'Argentina to beat Mexico', -165, 62.26, 1.606,
  ARRAY['DraftKings','FanDuel','BetMGM'], 3, 'mean',
  -150, 60.00, -15, 2.26,
  true
);

-- ---------------------------------------------------------------------------
-- 9. Broadcasters  (Where to Watch — US, for the Round of 16 match)
-- ---------------------------------------------------------------------------
INSERT INTO match_broadcasters (match_id, country_code, broadcaster_name, broadcaster_type, is_primary, display_order, language_code)
VALUES
  ((SELECT id FROM matches WHERE slug='argentina-vs-mexico-2026-06-30'), 'US', 'FOX',       'tv',        true,  1, 'en'),
  ((SELECT id FROM matches WHERE slug='argentina-vs-mexico-2026-06-30'), 'US', 'Telemundo', 'tv',        false, 2, 'es'),
  ((SELECT id FROM matches WHERE slug='argentina-vs-mexico-2026-06-30'), 'US', 'Peacock',   'streaming', false, 3, 'en');

-- ---------------------------------------------------------------------------
-- 10. Rankings history  (Trajectory sparkline — 5 editions; note the MD2 dip)
-- ---------------------------------------------------------------------------
INSERT INTO ranking_lists (slug, name, description, league_id, entity_type, list_type, composite_type, display_order)
VALUES (
  'team-power', 'Team Power Rankings', 'Sportsvyn 5-dimension team composite.',
  (SELECT id FROM leagues WHERE slug='fifa-wc-2026'),
  'team', 'composite', 'team_power', 0
);

INSERT INTO ranking_editions (ranking_list_id, edition_number, edition_label, status, is_current, published_at)
SELECT (SELECT id FROM ranking_lists WHERE slug='team-power'), v.num, v.label, 'published', v.cur, v.pub
FROM (VALUES
  (1, 'Pre-tournament',  false, TIMESTAMPTZ '2026-06-10 09:00-04'),
  (2, 'Post-Matchday 1', false, TIMESTAMPTZ '2026-06-15 09:00-04'),
  (3, 'Post-Matchday 2', false, TIMESTAMPTZ '2026-06-21 09:00-04'),
  (4, 'Post-Group',      false, TIMESTAMPTZ '2026-06-27 09:00-04'),
  (5, 'Current · R16',   true,  TIMESTAMPTZ '2026-06-29 09:00-04')
) AS v(num, label, cur, pub);

-- Argentina's entry per edition — scores trend up with a Matchday-2 dip (the 1-1 draw)
INSERT INTO ranking_entries (ranking_edition_id, entity_type, team_id, rank, score)
SELECT
  (SELECT e.id FROM ranking_editions e
     JOIN ranking_lists l ON l.id = e.ranking_list_id
    WHERE l.slug='team-power' AND e.edition_number = v.num),
  'team', (SELECT id FROM teams WHERE slug='argentina'), v.rank, v.score
FROM (VALUES
  (1, 3, 8.40),
  (2, 2, 8.50),
  (3, 3, 8.30),
  (4, 2, 8.60)
) AS v(num, rank, score);

-- Current edition entry gets the full Team Power dimension breakdown + sites layer
INSERT INTO ranking_entries (
  ranking_edition_id, entity_type, team_id, rank, score,
  previous_rank, rank_movement, previous_score, score_movement, movement_label,
  result_score, process_score, squad_score, coherence_score, momentum_score,
  fifa_rank, fifa_score, espn_rank, espn_score, sites_composite, editorial_composite
)
SELECT
  (SELECT e.id FROM ranking_editions e
     JOIN ranking_lists l ON l.id = e.ranking_list_id
    WHERE l.slug='team-power' AND e.edition_number = 5),
  'team', (SELECT id FROM teams WHERE slug='argentina'), 2, 8.70,
  3, 1, 8.60, 0.10, 'up',
  9.0, 7.8, 9.2, 8.0, 8.5,
  1, 9.50, 2, 9.10, 9.30, 8.50;

COMMIT;
