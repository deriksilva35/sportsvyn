-- 115_nfl_power_z_list.sql - the NFL power ranking Derik chose (27 Sep 2026),
-- as its OWN list beside the Elo board: nfl-power is untouched, and so is
-- teams.current_power_*. lib/rankings/nflPowerZ.js computes it; lib/rankings/
-- publishNflPowerZ.js writes its weekly editions.
--
-- is_active = false: HIDDEN until Derik publishes it. Nothing enumerates
-- ranking_lists (every reader asks for a slug), but an inactive row cannot
-- surface on any board that ever starts to. The hub reaches it by URL only,
-- /nfl/rankings?tab=power-z.
--
-- IDEMPOTENT: ON CONFLICT (slug) DO NOTHING.
INSERT INTO ranking_lists (slug, name, description, league_id, entity_type, list_type, composite_type,
                           sort_direction, display_limit, is_active, display_order)
SELECT 'nfl-power-z', 'NFL Power (z)',
       'Current season only: weighted z-scores of opponent-adjusted scoring, win% and quality of record.',
       l.id, 'team', 'composite', 'team_power', 'desc', 32, false, 90
  FROM leagues l WHERE l.slug = 'nfl'
ON CONFLICT (slug) DO NOTHING;
