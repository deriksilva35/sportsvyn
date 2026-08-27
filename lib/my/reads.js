// lib/my/reads.js - the dashboard's own reads. ALL READS, ZERO WRITES.
//
// Everything here is league-agnostic or explicitly multi-league. The WC-era
// panels this replaces carried `WHERE lg.slug = 'fifa-wc-2026'` in seven
// separate readers; that literal appears nowhere in this file, and the tests
// pin its absence.
//
// STATE DECISIONS COME FROM lib/today/slateRow.js, the same module the front
// page's week slate and TodaysGames use. Three surfaces, one answer to "is this
// game live" - the alternative is a dashboard that says LIVE while the front
// page says scheduled.

import { sql } from '../db.js';
import { orderSlate } from '../today/slateRow.js';

// The leagues a dashboard covers. The World Cup is deliberately absent: its
// last match was 19 Jul 2026 and every row is final.
export const MY_LEAGUES = Object.freeze(['cfb', 'nfl', 'epl']);

const GAME_COLS = `
  m.id, m.slug, m.status, m.kickoff_at, m.home_score, m.away_score,
  m.season_phase, m.week, l.slug AS league_slug,
  h.name AS home_name, h.abbreviation AS home_abbr,
  a.name AS away_name, a.abbreviation AS away_abbr`;

const GAME_FROM = `
  FROM matches m
  JOIN leagues l ON l.id = m.league_id
  LEFT JOIN teams h ON h.id = m.home_team_id
  LEFT JOIN teams a ON a.id = m.away_team_id`;

const shape = (r) => ({
  id: r.id,
  slug: r.slug,
  status: r.status,
  kickoffAt: r.kickoff_at,
  homeScore: r.home_score,
  awayScore: r.away_score,
  seasonPhase: r.season_phase,
  week: r.week,
  leagueSlug: r.league_slug,
  home: { name: r.home_name, abbreviation: r.home_abbr },
  away: { name: r.away_name, abbreviation: r.away_abbr },
});

/**
 * TODAY & NEXT, across every league the dashboard covers.
 *
 * Preseason is INCLUDED and labelled by the render, consistent with the front
 * page: the exclusion law governs ordering and landmarks, never visibility.
 */
export async function myTodayAndNext({ now = new Date(), limit = 3 } = {}) {
  const rows = await sql.query(
    `SELECT ${GAME_COLS} ${GAME_FROM}
      WHERE l.slug = ANY($1) AND m.kickoff_at >= $2
      ORDER BY m.kickoff_at ASC LIMIT $3`,
    [MY_LEAGUES, new Date(now).toISOString(), limit],
  );
  return rows.map(shape);
}

/** LIVE NOW - any league, any competition. Empty is the honest common case. */
export async function myLiveNow() {
  const rows = await sql.query(
    `SELECT ${GAME_COLS} ${GAME_FROM}
      WHERE l.slug = ANY($1) AND m.status = 'live'
      ORDER BY m.kickoff_at ASC`,
    [MY_LEAGUES],
  );
  return rows.map(shape);
}

/**
 * THE SLATE, for the filterable scoreboard panel.
 *
 * WATCHABILITY SCORING IS GONE, and that is the ruling rather than an omission:
 * match_watch_score_history holds 12,724 WC rows, 6,826 friendlies and 114 EPL
 * - and ZERO for nfl or cfb. Ordering by a score that does not exist for the
 * two leagues that matter would have produced an empty or arbitrary panel. It
 * orders by slateRow's live-upcoming-final rule instead, like every other game
 * list in the app.
 */
export async function mySlate({ now = new Date(), hours = 36, limit = 40 } = {}) {
  const from = new Date(new Date(now).getTime() - 6 * 3600_000).toISOString();
  const to = new Date(new Date(now).getTime() + hours * 3600_000).toISOString();
  const rows = await sql.query(
    `SELECT ${GAME_COLS} ${GAME_FROM}
      WHERE l.slug = ANY($1) AND m.kickoff_at BETWEEN $2 AND $3
      ORDER BY m.kickoff_at ASC LIMIT $4`,
    [MY_LEAGUES, from, to, limit],
  );
  return orderSlate(rows.map(shape));
}

/**
 * NEXT GAME PER FOLLOWED TEAM, any league.
 *
 * user_team_follows FKs to teams(id) with no league column, so this works for
 * gridiron and EPL rows exactly as it did for World Cup ones. DISTINCT ON gives
 * one row per followed team - a schedule, not a fixture list.
 */
export async function myFollowedTeamNext(userId, { now = new Date(), limit = 6 } = {}) {
  if (userId == null) return [];
  const rows = await sql.query(
    `SELECT DISTINCT ON (f.team_id)
            f.team_id, ft.name AS follow_name, ft.abbreviation AS follow_abbr,
            ${GAME_COLS}
       FROM user_team_follows f
       JOIN teams ft ON ft.id = f.team_id
       JOIN matches m ON (m.home_team_id = f.team_id OR m.away_team_id = f.team_id)
       JOIN leagues l ON l.id = m.league_id
       LEFT JOIN teams h ON h.id = m.home_team_id
       LEFT JOIN teams a ON a.id = m.away_team_id
      WHERE f.user_id = $1 AND m.kickoff_at >= $2
      ORDER BY f.team_id, m.kickoff_at ASC`,
    [Number(userId), new Date(now).toISOString()],
  );
  return rows
    .map((r) => ({ ...shape(r), followTeamId: r.team_id, followName: r.follow_abbr || r.follow_name }))
    .sort((x, y) => new Date(x.kickoffAt) - new Date(y.kickoffAt))
    .slice(0, limit);
}

/**
 * FOLLOWED PLAYERS. Zero rows is the state for every account today - the table
 * is empty, and until this relay gridiron player pages carried no follow
 * control at all, so 29,721 of them could not be followed even in principle.
 */
export async function myFollowedPlayers(userId, { limit = 5 } = {}) {
  if (userId == null) return [];
  const rows = await sql.query(
    `SELECT p.id, p.slug, p.full_name, p.position,
            t.name AS team_name, t.abbreviation AS team_abbr, l.slug AS league_slug
       FROM user_player_follows f
       JOIN players p ON p.id = f.player_id
       LEFT JOIN teams t ON t.id = p.current_team_id
       LEFT JOIN leagues l ON l.id = t.league_id
      WHERE f.user_id = $1
      ORDER BY f.followed_at DESC LIMIT $2`,
    [Number(userId), limit],
  );
  return rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.full_name, position: r.position,
    team: r.team_abbr || r.team_name, leagueSlug: r.league_slug,
  }));
}
