// lib/standings/read.js — reading standings. PURE of JSX; database only.
//
// ONE RULE ABOVE ALL: PRESEASON IS NEVER "THE RECORD". team_records holds
// preseason rows on purpose — they are real, they are labelled, and a
// preseason page could legitimately render them — but every caller asking the
// ordinary question "what is this team's record" must get the REGULAR season
// or nothing. That is enforced here, in the reader, rather than left to each
// surface to remember. A team page showing 1-2 in September because BDL served
// preseason from an endpoint documented as regular-season is exactly the
// failure this file exists to prevent.

import { sql } from '../db.js';

/** The record a surface means when it says "record". REG only, or null. */
export async function getTeamRecord(leagueSlug, teamId, season) {
  const [r] = await sql`
    SELECT tr.wins, tr.losses, tr.ties,
           tr.conf_wins, tr.conf_losses, tr.conf_ties,
           tr.home_wins, tr.home_losses, tr.home_ties,
           tr.away_wins, tr.away_losses, tr.away_ties,
           tr.neutral_wins, tr.neutral_losses, tr.neutral_ties,
           tr.div_wins, tr.div_losses, tr.div_ties,
           tr.points_for, tr.points_against, tr.streak, tr.playoff_seed,
           tr.conference, tr.division, tr.classification,
           tr.season, tr.season_type, tr.data_provider, tr.data_provider_synced_at
      FROM team_records tr
      JOIN leagues l ON l.id = tr.league_id
     WHERE l.slug = ${leagueSlug} AND tr.team_id = ${teamId}
       AND tr.season = ${season} AND tr.season_type = 'regular'
     LIMIT 1`;
  return r ?? null;
}

/** Every REG record in a league-season, for a standings page. */
export async function getLeagueRecords(leagueSlug, season, { classification = null } = {}) {
  return sql`
    SELECT tr.*, t.name, t.short_name, t.abbreviation, t.slug
      FROM team_records tr
      JOIN leagues l ON l.id = tr.league_id
      JOIN teams   t ON t.id = tr.team_id
     WHERE l.slug = ${leagueSlug} AND tr.season = ${season}
       AND tr.season_type = 'regular'
       AND (${classification}::text IS NULL OR tr.classification = ${classification})
     ORDER BY tr.wins DESC, tr.losses ASC, t.name ASC`;
}

/** The EPL table, in table order. */
export async function getLeagueTable(leagueSlug, season) {
  return sql`
    SELECT lt.rank, lt.played, lt.win, lt.draw, lt.lose,
           lt.goals_for, lt.goals_against, lt.goal_diff, lt.points,
           lt.form, lt.movement_status, lt.qualification_description,
           lt.group_name, lt.data_provider_synced_at,
           t.id AS team_id, t.name, t.short_name, t.abbreviation, t.slug
      FROM league_tables lt
      JOIN leagues l ON l.id = lt.league_id
      JOIN teams   t ON t.id = lt.team_id
     WHERE l.slug = ${leagueSlug} AND lt.season = ${season}
     ORDER BY lt.rank ASC`;
}

/** "9-3" or "9-3-1" — a tie column only appears when there is a tie. PURE. */
export function formatRecord(w, l, t) {
  if (w == null || l == null) return null;
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}
