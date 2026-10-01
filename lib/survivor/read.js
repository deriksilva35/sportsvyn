// lib/survivor/read.js - every Survivor read: the pool, the schedule's weeks,
// one week's games with their lines, an entry and its picks.
//
// THE SCHEDULE IS matches. A pool's `sport` is the sports-league slug its weeks
// come from ('nfl'); REG season only. Lines come from the ONE odds pipeline
// (lib/gridiron/oddsReader.js getSpreadHome / getH2hOdds) - the same rows the
// Pick'em board and the Market read, never a second reader.

import { sql } from '../db.js';
import { getSpreadHome, getH2hOdds } from '../gridiron/oddsReader.js';
import { openWeek, teamRows, survivorSport } from './rules.js';

/** The national pool for a sport-season, or null (118 unapplied, or none seeded). */
export async function nationalPool(season, sport = 'nfl') {
  const [p] = await sql`
    SELECT * FROM survivor_pools
     WHERE league_id IS NULL AND sport = ${sport} AND season_year = ${season}`;
  return p ?? null;
}

export async function poolById(poolId) {
  const [p] = await sql`SELECT * FROM survivor_pools WHERE id = ${poolId}`;
  return p ?? null;
}

/**
 * The newest pool year with a national pool - the page's default, so the route
 * never types a season.
 */
export async function currentNationalPool(sport = survivorSport()) {
  const [p] = await sql`
    SELECT * FROM survivor_pools
     WHERE league_id IS NULL AND sport = ${sport}
     ORDER BY season_year DESC LIMIT 1`;
  return p ?? null;
}

/**
 * One row per REG week of the pool's season: first/last kickoff, game count,
 * and done = every game final or cancelled.
 */
export async function seasonWeeks(pool) {
  const rows = await sql`
    SELECT m.week, min(m.kickoff_at) AS first_kickoff, max(m.kickoff_at) AS last_kickoff,
           count(*)::int AS games,
           bool_and(m.status IN ('final', 'cancelled')) AS done
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = ${pool.sport} AND m.season_year = ${pool.season_year}
       AND m.season_phase = 'REG' AND m.week IS NOT NULL
     GROUP BY m.week ORDER BY m.week`;
  return rows.map((r) => ({ ...r, week: Number(r.week) }));
}

/** Weeks of this pool with at least one pending pick. */
export async function pendingWeeks(poolId) {
  const rows = await sql`SELECT DISTINCT week FROM survivor_picks WHERE pool_id = ${poolId} AND result = 'pending'`;
  return new Set(rows.map((r) => Number(r.week)));
}

/** The open week number for a pool at `now`, plus the weeks it was read from. */
export async function poolWeek(pool, now = new Date()) {
  const [weeks, pending] = await Promise.all([seasonWeeks(pool), pendingWeeks(pool.id)]);
  return { week: openWeek(weeks, { startWeek: pool.start_week, now, pendingWeeks: pending }), weeks };
}

/** One week's games, teams resolved, ordered by kickoff. */
export async function weekGames(pool, week) {
  const rows = await sql`
    SELECT m.id AS match_id, m.kickoff_at, m.status, m.home_score, m.away_score,
           m.home_team_id, m.away_team_id,
           h.abbreviation AS home_abbr, h.name AS home_name,
           a.abbreviation AS away_abbr, a.name AS away_name
      FROM matches m JOIN leagues l ON l.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE l.slug = ${pool.sport} AND m.season_year = ${pool.season_year}
       AND m.season_phase = 'REG' AND m.week = ${week}
     ORDER BY m.kickoff_at, m.id`;
  return rows.map((r) => ({
    match_id: r.match_id, kickoff_at: r.kickoff_at, status: r.status,
    home_score: r.home_score, away_score: r.away_score,
    home_team_id: r.home_team_id, away_team_id: r.away_team_id,
    home: { id: r.home_team_id, abbr: r.home_abbr, name: r.home_name },
    away: { id: r.away_team_id, abbr: r.away_abbr, name: r.away_name },
  }));
}

/**
 * THE WEEK'S BOARD: every team with a game, favorites first, each with its own
 * spread (lib/survivor/rules.js teamRows). A line read that throws is an empty
 * map - the board still lists the teams, unsorted by line, rather than failing.
 */
export async function weekBoard(pool, week) {
  const games = await weekGames(pool, week);
  const ids = games.map((g) => g.match_id);
  const [spreads, h2h] = await Promise.all([
    getSpreadHome(ids).catch(() => new Map()),
    getH2hOdds(ids).catch(() => new Map()),
  ]);
  return { games, rows: teamRows(games, spreads, h2h) };
}

/** An entry (or null) and every pick of it, with the team and the game. */
export async function entryWithPicks(poolId, userId) {
  const [entry] = await sql`SELECT * FROM survivor_entries WHERE pool_id = ${poolId} AND user_id = ${userId}`;
  if (!entry) return { entry: null, picks: [] };
  const picks = await sql`
    SELECT p.week, p.team_id, p.match_id, p.auto, p.result, p.picked_at, p.graded_at,
           t.abbreviation AS abbr, t.name AS team_name,
           m.kickoff_at, m.status, m.home_score, m.away_score, m.home_team_id, m.away_team_id
      FROM survivor_picks p
      LEFT JOIN teams t ON t.id = p.team_id
      LEFT JOIN matches m ON m.id = p.match_id
     WHERE p.pool_id = ${poolId} AND p.user_id = ${userId}
     ORDER BY p.week`;
  return { entry, picks: picks.map((p) => ({ ...p, week: Number(p.week) })) };
}

/** Alive / total for a pool - the header's "N of M still alive". */
export async function poolCounts(poolId) {
  const [r] = await sql`
    SELECT count(*)::int AS entries,
           count(*) FILTER (WHERE eliminated_week IS NULL)::int AS alive
      FROM survivor_entries WHERE pool_id = ${poolId}`;
  return { entries: r?.entries ?? 0, alive: r?.alive ?? 0 };
}
