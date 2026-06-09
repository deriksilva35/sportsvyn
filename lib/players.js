// lib/players.js — Player page data access.
//
// Pattern mirrors lib/teams.js: tagged-template queries against neon,
// each function returns plain objects or null/[] on absence (Server
// Components consume directly). Single-statement queries only.
//
// Scope is the player profile page (/player/[slug]). Today only the
// HERO (identity + team) and MATCH LOG (3 group fixtures) populate;
// every other page section reads dormant on the route. Helpers here
// are kept narrow so when stats / composite / outlook land they can
// be added alongside without restructuring.

import { sql } from '@/lib/db';

// =============================================================================
// getPlayerBySlug(slug) — identity row + team affiliation for the hero.
//
// JOINs on current_team_id (FK, unique) so the duplicate-team-slug noise on
// the teams table doesn't affect us here (that's a problem for the
// slug-lookup path getTeamBySlug solves). Players have no duplicate slugs
// (audited 0 on both DEV and PROD).
// =============================================================================
export async function getPlayerBySlug(slug) {
  const rows = await sql`
    SELECT
      p.id, p.slug, p.full_name, p.known_as, p.position,
      p.current_team_id, p.current_team_jersey_number,
      p.photo_url_source, p.photo_url_treated, p.photo_treatment_recipe,
      p.metadata,
      t.id    AS team_id,
      t.slug  AS team_slug,
      t.name  AS team_name,
      t.short_name AS team_short_name,
      t.abbreviation AS team_abbreviation,
      t.flag_svg_path,
      t.flag_color_primary,
      lg.slug AS league_slug
    FROM players p
    LEFT JOIN teams   t  ON t.id  = p.current_team_id
    LEFT JOIN leagues lg ON lg.id = t.league_id
    WHERE p.slug = ${slug}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// =============================================================================
// getTeamSquad(teamId) — full roster for a team's profile page squad section.
//
// Stats-independent — reads ONLY players-by-current_team_id, so this renders
// even though player_tournament_stats has 0 rows today. ORDER BY puts GK first
// then DEF/MID/ATT (the standard squad-sheet order), then jersey, then name.
// Caller groups in render. NULL jersey numbers sort last within their group.
// Returns [] if the team has no players.
// =============================================================================
export async function getTeamSquad(teamId) {
  if (teamId == null) return [];
  const rows = await sql`
    SELECT slug, full_name, known_as, position, current_team_jersey_number,
           photo_url_source
      FROM players
     WHERE current_team_id = ${teamId}
     ORDER BY
       CASE position
         WHEN 'GK'  THEN 1
         WHEN 'DEF' THEN 2
         WHEN 'MID' THEN 3
         WHEN 'ATT' THEN 4
         ELSE 5
       END,
       current_team_jersey_number ASC NULLS LAST,
       full_name ASC
  `;
  return rows;
}

// =============================================================================
// getPlayerGroupFixtures(teamId) — the player's team's 3 group-stage matches.
//
// Returns all WC group-stage matches involving the team, ordered by kickoff.
// Each row carries enough to render the match-by-match log row in upcoming /
// live / final state. Returns [] if the team has no fixtures (which would
// surface the dormant empty-state on the page).
// =============================================================================
export async function getPlayerGroupFixtures(teamId) {
  if (teamId == null) return [];
  const rows = await sql`
    SELECT m.id, m.slug, m.stage, m.group_code, m.kickoff_at, m.venue, m.status,
           m.home_team_id, m.away_team_id,
           m.home_score, m.away_score,
           ht.name AS home_name, ht.slug AS home_slug, ht.abbreviation AS home_abbr, ht.flag_svg_path AS home_flag,
           at.name AS away_name, at.slug AS away_slug, at.abbreviation AS away_abbr, at.flag_svg_path AS away_flag
      FROM matches m
      LEFT JOIN teams ht ON ht.id = m.home_team_id
      LEFT JOIN teams at ON at.id = m.away_team_id
      JOIN leagues lg ON lg.id = m.league_id
     WHERE lg.slug = 'fifa-wc-2026'
       AND m.stage = 'group'
       AND (m.home_team_id = ${teamId} OR m.away_team_id = ${teamId})
     ORDER BY m.kickoff_at ASC
  `;
  return rows;
}
