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
import { formatRecord, recordChip, ordinal } from './view.js';

// Re-exported so `formatRecord` has one import path for callers that already
// hold the reader. Its definition is in view.js, which owns pure formatting.
export { formatRecord };

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

/**
 * team_id -> the chip a card should show, across every league on one slate.
 *
 * THREE LEAGUES, THREE GRAMMARS, ONE MAP. Gridiron teams get a record ("9-3");
 * Premier League clubs get a table POSITION ("3rd"), because that is what a
 * supporter says and a soccer club's W-D-L is not how anyone describes it.
 * The difference lives here rather than in the card, so the card renders a
 * string or nothing.
 *
 * NOTHING IS INVENTED. A team with no stored record, or one whose record is
 * 0-0, is simply absent from the map and its card shows no chip.
 * EVERY SOURCE IS FAILURE-TOLERANT: a chip is decoration, and no scoreboard
 * should fail to render because a standings row is missing.
 */
export async function recordChipMap(season) {
  const out = new Map();
  try {
    const rows = await sql`
      SELECT tr.team_id, tr.wins, tr.losses, tr.ties
        FROM team_records tr JOIN leagues l ON l.id = tr.league_id
       WHERE l.slug IN ('nfl', 'cfb') AND tr.season = ${season}
         AND tr.season_type = 'regular'`;
    for (const r of rows) {
      if ((r.wins ?? 0) + (r.losses ?? 0) + (r.ties ?? 0) === 0) continue;
      const s = formatRecord(r.wins, r.losses, r.ties);
      if (s) out.set(r.team_id, s);
    }
  } catch { /* a chip is decoration; a missing table must not break a slate */ }

  for (const [k, v] of await eplPositionChips()) out.set(k, v);

  return out;
}

/**
 * The chip string for ONE team on a game page, or null.
 *
 * A thin compose of getTeamRecord (which enforces REG) and recordChip (which
 * enforces "claim knowledge or say nothing"), plus the catch that keeps a game
 * page rendering when standings are absent. Surfaces call THIS rather than
 * wiring the two together themselves, so the two rules cannot come apart.
 */
export async function getTeamRecordChip(leagueSlug, teamId, season) {
  if (!teamId || !season) return null;
  try {
    return recordChip(leagueSlug, await getTeamRecord(leagueSlug, teamId, season));
  } catch { return null; }
}

/**
 * EPL team_id -> "3rd". Its own function because most callers want ONLY this:
 * a match page has no use for 272 gridiron records, and recordChipMap's job is
 * to serve a mixed slate, not to be the only way in.
 *
 * Reads the SAME stored document /epl/standings reads — ruling 2c keeps EPL on
 * leagues.metadata.standings until the league_tables migration, and a second
 * source for the same fact is exactly what that ruling was avoiding.
 */
export async function eplPositionChips() {
  const out = new Map();
  try {
    const { getEplStandings } = await import('../soccer/standings.js');
    const doc = await getEplStandings();
    if (!doc?.rows?.length) return out;
    const ids = await sql`
      SELECT t.id, t.external_ids->>'api_sports' AS pid
        FROM teams t JOIN leagues l ON l.id = t.league_id
       WHERE l.slug = 'epl' AND t.external_ids ? 'api_sports'`;
    const byProvider = new Map(ids.map((r) => [String(r.pid), r.id]));
    for (const r of doc.rows) {
      const ourId = byProvider.get(String(r.teamId));
      const o = ordinal(r.rank);
      if (ourId && o) out.set(ourId, o);
    }
  } catch { /* a chip is decoration; absence is silence, never a crash */ }
  return out;
}
