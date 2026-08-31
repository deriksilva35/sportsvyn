// lib/gridiron/leagueRail.js — the league landing's ranking rail.
//
// ONE COMPONENT, LEAGUE-SHAPED BY DATA. College reads the AP poll; the NFL
// reads the Sportsvyn power rankings. Those are two different sources with two
// different meanings - one is somebody else's published list, the other is
// ours - so what varies is the READ, not the render. Both produce the same
// chip shape and the component downstream cannot tell them apart.
//
// AP IS SELECTED BY NAME, NEVER BY INDEX, and that law is enforced upstream:
// lib/cfb/rankings.js maps the poll NAME to its own table, so reading
// ap_rankings IS reading the AP poll. There is no polls array here to index
// into and get the Coaches Poll by accident.
//
// THE NFL RAIL READS THE LIST THAT ALREADY EXISTS. nfl-power has been a
// published ranking_list since Edition 0 and /nfl/rankings?tab=power already
// serves it; a second power-rankings table would have been two stores for one
// board and two places to disagree. Movement comes from the edition machinery
// the World Cup boards have used for 21 editions.

import { sql } from '../db.js';

/** The CFB rail: the AP Top 25 for a season/week, with each team's REG record. */
export async function apRail(season, week) {
  if (!season || !week) return [];
  return sql`
    SELECT ap.rank, ap.team_id, t.abbreviation, t.name,
           tr.wins, tr.losses, tr.ties,
           prev.rank AS previous_rank
      FROM ap_rankings ap
      JOIN teams t ON t.id = ap.team_id
      LEFT JOIN leagues l ON l.id = t.league_id
      LEFT JOIN team_records tr
             ON tr.team_id = ap.team_id AND tr.league_id = t.league_id
            AND tr.season = ap.season AND tr.season_type = 'regular'
      -- THE PRIOR WEEK OF THE SAME POLL. A left join, so week 1 - where there
      -- is no prior week at all - yields NULL and the chip shows no arrow.
      LEFT JOIN ap_rankings prev
             ON prev.team_id = ap.team_id AND prev.season = ap.season
            AND prev.season_type = ap.season_type AND prev.week = ${week} - 1
     WHERE ap.season = ${season} AND ap.week = ${week} AND ap.season_type = 'regular'
     ORDER BY ap.rank ASC`;
}

/** The NFL rail: the current published nfl-power edition, with records. */
export async function powerRail(leagueSlug, season) {
  return sql`
    SELECT e.rank, e.team_id, e.selection_label AS name, t.abbreviation,
           tr.wins, tr.losses, tr.ties,
           -- PREVIOUS_RANK IS STORED ON THE ENTRY, written by whoever published
           -- the edition. Deriving it here by re-reading the prior edition
           -- would be a second opinion about the same fact.
           e.previous_rank
      FROM ranking_entries e
      JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
                              AND ed.is_current AND ed.status = 'published'
      JOIN ranking_lists rl ON rl.id = ed.ranking_list_id
      JOIN leagues lg ON lg.id = rl.league_id AND lg.slug = ${leagueSlug}
      LEFT JOIN teams t ON t.id = e.team_id
      LEFT JOIN team_records tr
             ON tr.team_id = e.team_id AND tr.league_id = lg.id
            AND tr.season = ${season} AND tr.season_type = 'regular'
     WHERE rl.slug = 'nfl-power'
     ORDER BY e.rank ASC`;
}

/**
 * The rail for a league. Returns [] when we hold nothing - the surface renders
 * NO RAIL rather than an empty one, because a rail with no chips is furniture
 * announcing an absence.
 */
export async function railFor(leagueSlug, { season, apWeek = null } = {}) {
  try {
    const rows = leagueSlug === 'cfb'
      ? await apRail(season, apWeek)
      : await powerRail(leagueSlug, season);
    return rows ?? [];
  } catch { return []; }
}
