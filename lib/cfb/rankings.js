// lib/cfb/rankings.js - the AP Top 25 and Coaches Poll, from CFBD to the page.
//
// POLL SELECTION IS BY NAME, ALWAYS. CFBD returns a `polls` array whose
// membership VARIES BY WEEK - 2025 week 10 carried five polls, 2026 week 1
// carries three - and the Coaches Poll is polls[0] in both. Any index-based
// access silently reads a different poll that has the identical shape and
// disagrees on real teams: this week AP has Notre Dame 4th and Texas 5th while
// the Coaches Poll has them the other way round. A board built off the wrong
// poll would look completely plausible and be wrong.
//
// A MISSING POLL THROWS. It does not fall back to another one, and it does not
// return an empty list that a caller could mistake for "nobody is ranked" -
// which, for the inclusion rule, would mean an empty board.
//
// TIES ARE REAL. The 2026 week 1 AP poll ranks USC and BYU joint 14th and has
// no 15th. Nothing here renumbers, deduplicates or "fixes" that - the poll says
// what it says, and rank is stored as published.

import { sql } from '../db.js';

export const AP_POLL = 'AP Top 25';
export const COACHES_POLL = 'Coaches Poll';

/** The tables each poll lives in. Separate, so the wrong one is unreachable. */
const TABLE = { [AP_POLL]: 'ap_rankings', [COACHES_POLL]: 'coaches_rankings' };

/**
 * Pull one named poll out of a CFBD week envelope.
 * @throws when the week does not carry that poll at all.
 */
export function pollFromWeek(weekEnvelope, pollName) {
  const polls = weekEnvelope?.polls;
  if (!Array.isArray(polls)) {
    throw new Error(`rankings: week envelope has no polls array`);
  }
  const hit = polls.find((p) => p.poll === pollName);
  if (!hit) {
    const names = polls.map((p) => p.poll).join(' | ');
    throw new Error(`rankings: "${pollName}" absent this week; present: ${names}`);
  }
  if (!Array.isArray(hit.ranks) || !hit.ranks.length) {
    throw new Error(`rankings: "${pollName}" carried no ranks`);
  }
  return hit;
}

/**
 * CFBD rank rows -> our shape, with team ids resolved. A ranked team we cannot
 * resolve is NAMED and dropped rather than stored against a null team - the
 * inclusion rule joins on team_id, so a null would silently un-rank a team.
 */
export function normalizeRanks(poll, teamMap) {
  const rows = [];
  const unresolved = [];
  for (const r of poll.ranks) {
    const teamId = teamMap.get(String(r.teamId));
    if (teamId == null) { unresolved.push(`${r.rank} ${r.school}`); continue; }
    rows.push({
      teamId,
      rank: r.rank,
      points: r.points ?? null,
      firstPlaceVotes: r.firstPlaceVotes ?? null,
    });
  }
  return { rows, unresolved };
}

/** cfbd team id -> our teams.id, for the CFB league. */
export async function cfbTeamMap() {
  const rows = await sql`
    SELECT t.id, t.external_ids->>'cfbd_team_id' AS pid
      FROM teams t JOIN leagues l ON l.id = t.league_id
     WHERE l.slug = 'cfb' AND t.external_ids ? 'cfbd_team_id'`;
  return new Map(rows.map((r) => [r.pid, r.id]));
}

/** Idempotent write, the plays pattern: re-importing a week corrects it. */
export async function writeRanks(pollName, { season, week, seasonType = 'regular' }, rows) {
  const table = TABLE[pollName];
  if (!table) throw new Error(`rankings: no table for poll "${pollName}"`);
  let written = 0;
  for (const r of rows) {
    // Table name cannot be parameterised; it comes from the TABLE map above,
    // never from a caller's string, so there is nothing user-controlled here.
    await sql.query(
      `INSERT INTO ${table} (season, week, season_type, team_id, rank, points, first_place_votes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (season, week, season_type, team_id) DO UPDATE SET
         rank = EXCLUDED.rank, points = EXCLUDED.points,
         first_place_votes = EXCLUDED.first_place_votes, updated_at = now()`,
      [season, week, seasonType, r.teamId, r.rank, r.points, r.firstPlaceVotes],
    );
    written++;
  }
  return written;
}

/** The newest week we hold for a poll. */
export async function latestWeek(pollName, season, seasonType = 'regular') {
  const table = TABLE[pollName];
  if (!table) throw new Error(`rankings: no table for poll "${pollName}"`);
  const rows = await sql.query(
    `SELECT max(week) AS week FROM ${table} WHERE season = $1 AND season_type = $2`,
    [season, seasonType],
  );
  return rows[0]?.week ?? null;
}

/**
 * One poll, one week, in rank order, with movement against the PRIOR week.
 *
 * MOVEMENT IS NULL WHEN THERE IS NO PRIOR WEEK, and null is rendered as
 * nothing - not a zero, not a dash pretending to be "unchanged". Week 1 has no
 * previous poll to diff against, so week 1 shows no movement at all, which is
 * the honest reading of a first poll.
 */
export async function pollTable(pollName, { season, week, seasonType = 'regular' }) {
  const table = TABLE[pollName];
  if (!table) throw new Error(`rankings: no table for poll "${pollName}"`);
  const rows = await sql.query(
    `SELECT r.rank, r.points, r.first_place_votes, r.team_id,
            COALESCE(t.short_name, t.name) AS team, t.slug AS team_slug,
            prev.rank AS previous_rank
       FROM ${table} r
       JOIN teams t ON t.id = r.team_id
       LEFT JOIN ${table} prev
              ON prev.team_id = r.team_id AND prev.season = r.season
             AND prev.season_type = r.season_type AND prev.week = r.week - 1
      WHERE r.season = $1 AND r.season_type = $2 AND r.week = $3
      ORDER BY r.rank ASC, t.name ASC`,
    [season, seasonType, week],
  );
  // Did a prior week exist AT ALL? A team absent from last week's poll and a
  // week with no poll at all both produce previous_rank null on that row; only
  // the week-level check tells them apart.
  const prior = await sql.query(
    `SELECT 1 FROM ${table} WHERE season = $1 AND season_type = $2 AND week = $3 LIMIT 1`,
    [season, seasonType, week - 1],
  );
  const hasPrior = prior.length > 0;

  return rows.map((r) => ({
    rank: r.rank,
    team: r.team,
    teamId: r.team_id,
    teamSlug: r.team_slug,
    points: r.points,
    firstPlaceVotes: r.first_place_votes,
    previousRank: hasPrior ? (r.previous_rank ?? null) : null,
    // Positive = climbed. Null when there is no prior week, or when the team is
    // newly ranked - "new" is not a movement of some number of places.
    movement: hasPrior && r.previous_rank != null ? r.previous_rank - r.rank : null,
    isNew: hasPrior && r.previous_rank == null,
  }));
}

/**
 * AP rank per team for a week, as a lookup. THIS IS WHAT THE BADGES READ, and
 * it is AP only - the Coaches Poll drives nothing on the platform.
 */
export async function apRankMap({ season, week, seasonType = 'regular' }) {
  if (season == null || week == null) return new Map();
  const rows = await sql`
    SELECT team_id, rank FROM ap_rankings
     WHERE season = ${season} AND season_type = ${seasonType} AND week = ${week}`;
  return new Map(rows.map((r) => [r.team_id, r.rank]));
}

/** The current AP week for a season - what a badge lookup should use. */
export async function currentApWeek(season, seasonType = 'regular') {
  return latestWeek(AP_POLL, season, seasonType);
}

/** The newest season we hold this poll for. Null when we hold none. */
export async function latestPollSeason(pollName, seasonType = 'regular') {
  const table = TABLE[pollName];
  if (!table) throw new Error(`rankings: no table for poll "${pollName}"`);
  const rows = await sql.query(
    `SELECT max(season) AS season FROM ${table} WHERE season_type = $1`, [seasonType],
  );
  return rows[0]?.season ?? null;
}

/**
 * The AP poll's top N, for the dashboard panel.
 *
 * POLL SELECTION IS BY NAME, never by index: AP and the Coaches Poll arrive in
 * one payload whose order is the provider's, and taking [0] would silently swap
 * the two the first time CFBD reorders them. AP_POLL is the constant, and
 * pollTable resolves the latest published week for it.
 *
 * Returns [] before the first poll of a season is published - a real state in
 * August, not an error.
 */
export async function apPollTop(limit = 5, season = null) {
  const yr = season ?? new Date().getUTCFullYear();
  const wk = await latestWeek(AP_POLL, yr);
  if (wk == null) return [];
  const rows = await pollTable(AP_POLL, { season: yr, week: wk });
  return (rows ?? []).slice(0, limit);
}
