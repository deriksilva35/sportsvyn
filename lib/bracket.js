// lib/bracket.js — WC group-stage reads, shared by /bracket + homepage.
//
// Read-only. These queries previously lived inline in app/bracket/page.js
// (as getGroupTeams, getGroupMatchdayProgress, getGroupStageComplete).
// Lifted here so the homepage's "The Bracket" wall reads from the same
// source as the /bracket page — one query lives in one place.
//
// Behavioral contract preserved exactly: same SQL, same return shapes
// (Map<group_code, ...>), so /bracket/page.js can import these without
// any rendering change.

import { sql } from './db.js';

export const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

const WC_LEAGUE_SLUG = 'fifa-wc-2026';

// Returns Map<group_letter, [{ id, name, slug, flag_svg_path }, ...]>.
// Pulled from matches.home_team_id ∪ matches.away_team_id where
// stage='group' AND group_code IS NOT NULL — so a team appears in
// whichever group its WC fixtures bind it to (no separate
// team→group join table in the schema).
export async function getGroupTeams() {
  const rows = await sql`
    WITH wc_league AS (
      SELECT id FROM leagues WHERE slug = ${WC_LEAGUE_SLUG} LIMIT 1
    ),
    wc_group_teams AS (
      SELECT m.group_code, m.home_team_id AS team_id
        FROM matches m, wc_league
       WHERE m.league_id = wc_league.id AND m.stage = 'group' AND m.group_code IS NOT NULL
      UNION
      SELECT m.group_code, m.away_team_id AS team_id
        FROM matches m, wc_league
       WHERE m.league_id = wc_league.id AND m.stage = 'group' AND m.group_code IS NOT NULL
    )
    SELECT
      wgt.group_code,
      t.id, t.name, t.slug, t.flag_svg_path
    FROM wc_group_teams wgt
    JOIN teams t ON t.id = wgt.team_id
    ORDER BY wgt.group_code, t.name
  `;
  const byLetter = new Map();
  for (const r of rows) {
    if (!byLetter.has(r.group_code)) byLetter.set(r.group_code, []);
    byLetter.get(r.group_code).push(r);
  }
  return byLetter;
}

// Returns Map<group_letter, matchdays_complete> where matchdays_complete
// = floor(finals_in_group / 2). Each group plays 2 simultaneous matches
// per matchday (4 teams = 2 pairings), so 2 finals = 1 matchday done.
export async function getGroupMatchdayProgress() {
  const rows = await sql`
    SELECT
      group_code,
      count(*) FILTER (WHERE status = 'final')::int AS finals
    FROM matches
    WHERE league_id = (SELECT id FROM leagues WHERE slug = ${WC_LEAGUE_SLUG})
      AND stage = 'group'
      AND group_code IS NOT NULL
    GROUP BY group_code
  `;
  const byLetter = new Map();
  for (const r of rows) byLetter.set(r.group_code, Math.floor(r.finals / 2));
  return byLetter;
}

// Boolean: have all 72 (12 groups × 6) group-stage matches concluded?
// Strict equality on 72: a partial seed (e.g. dev env with <72 fixtures)
// can't false-trigger this.
export async function getGroupStageComplete() {
  const rows = await sql`
    SELECT count(*)::int AS final_count
    FROM matches
    WHERE league_id = (SELECT id FROM leagues WHERE slug = ${WC_LEAGUE_SLUG})
      AND stage = 'group'
      AND status = 'final'
  `;
  return rows[0]?.final_count === 72;
}

// Aggregate counts for the homepage's tournament-progress strip:
// total / final / live group-stage matches across all groups.
// Returns { total_group, final_group, live_group, total_matchdays_played }.
// total_matchdays_played = sum(floor(finals_per_group / 2)) across 12 groups.
export async function getGroupStageProgress() {
  const rows = await sql`
    SELECT
      count(*)::int                                  AS total_group,
      count(*) FILTER (WHERE status = 'final')::int  AS final_group,
      count(*) FILTER (WHERE status = 'live')::int   AS live_group
    FROM matches
    WHERE league_id = (SELECT id FROM leagues WHERE slug = ${WC_LEAGUE_SLUG})
      AND stage = 'group'
  `;
  const matchdayMap = await getGroupMatchdayProgress();
  let totalMatchdaysPlayed = 0;
  for (const v of matchdayMap.values()) totalMatchdaysPlayed += v;
  return {
    total_group: rows[0]?.total_group ?? 0,
    final_group: rows[0]?.final_group ?? 0,
    live_group:  rows[0]?.live_group  ?? 0,
    total_matchdays_played: totalMatchdaysPlayed,
  };
}
