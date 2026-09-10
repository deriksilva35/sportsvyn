-- 100: the rolling lock (R1). contests.locks_at becomes the join-window close,
-- the last kickoff of the contest's slate, computed from matches - nothing is
-- hand-typed. Data only, no DDL. Applies to this week's Weekly (2) and the
-- two Pick'em boards (6, 7); the Draft (3) is untouched until ruled.
UPDATE contests c
   SET locks_at = s.last_ko
  FROM (SELECT c2.id, max(m.kickoff_at) AS last_ko
          FROM contests c2
          JOIN leagues l ON l.slug = c2.sport
          JOIN matches m ON m.league_id = l.id AND m.season_year = c2.season_year
                        AND m.week = c2.week AND m.season_phase = 'REG'
         WHERE c2.id = 2 AND c2.game_type = 'weekly'
         GROUP BY c2.id) s
 WHERE c.id = s.id AND s.last_ko IS NOT NULL;
UPDATE contests c
   SET locks_at = s.last_ko
  FROM (SELECT c2.id, max(m.kickoff_at) AS last_ko
          FROM contests c2
          CROSS JOIN LATERAL jsonb_array_elements(c2.board) g
          JOIN matches m ON m.id = (g->>'match_id')::int
         WHERE c2.id IN (6, 7) AND c2.game_type = 'pickem'
         GROUP BY c2.id) s
 WHERE c.id = s.id AND s.last_ko IS NOT NULL;
