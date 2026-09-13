// lib/follows.js — read-only follow-state helpers for the My Sportsvyn
// track. Writes live in app/actions/follows.js so they can call auth()
// and re-validate the route in one place.
//
// Returning conventions:
//   · null / undefined userId → safe-default (false / empty Set) so a
//     caller can pass session?.user?.id directly without a branch.
//   · empty input arrays/sets → empty result, no DB hit.
//   · never throws on absence. Errors propagate as you'd expect from
//     the neon HTTP driver for genuine SQL failures only.

import { sql } from './db.js';

// =============================================================================
// isFollowingTeam(userId, teamId) — single-key existence check.
//
// Returns false (not throws) when userId is null — the logged-out
// render path is the common case and shouldn't need a branch upstream.
// =============================================================================
export async function isFollowingTeam(userId, teamId) {
  if (userId == null || teamId == null) return false;
  const rows = await sql`
    SELECT 1 FROM user_team_follows
     WHERE user_id = ${userId} AND team_id = ${teamId}
     LIMIT 1
  `;
  return rows.length > 0;
}

// =============================================================================
// getFollowedTeamIds(userId) — all teams the user follows, as a Set<int>.
//
// Set (not array) because the typical consumer is "is this team_id in
// my follow list?" — O(1) lookup as the page iterates fixtures /
// rankings / etc. Returns an empty Set when userId is null so the
// "render volt on followed teams" pattern collapses to a no-op for
// logged-out users without a branch.
//
// Ordered DESC by followed_at at the SQL level so a caller wanting a
// "My Teams" list (most-recent first) can just iterate Array.from(set).
// =============================================================================
export async function getFollowedTeamIds(userId) {
  if (userId == null) return new Set();
  const rows = await sql`
    SELECT team_id FROM user_team_follows
     WHERE user_id = ${userId}
     ORDER BY followed_at DESC
  `;
  return new Set(rows.map((r) => r.team_id));
}

// =============================================================================
// Player-follow helpers — exact mirrors of the team helpers above.
// =============================================================================

export async function isFollowingPlayer(userId, playerId) {
  if (userId == null || playerId == null) return false;
  const rows = await sql`
    SELECT 1 FROM user_player_follows
     WHERE user_id = ${userId} AND player_id = ${playerId}
     LIMIT 1
  `;
  return rows.length > 0;
}

export async function getFollowedPlayerIds(userId) {
  if (userId == null) return new Set();
  const rows = await sql`
    SELECT player_id FROM user_player_follows
     WHERE user_id = ${userId}
     ORDER BY followed_at DESC
  `;
  return new Set(rows.map((r) => r.player_id));
}

// =============================================================================
// getFollowedTeams(userId) — the follow list as ROWS, newest first.
//
// getFollowedTeamIds answers "is this team mine?" and a Set is right for
// that. A list surface asks the other question - "which teams are mine, and
// what are they called" - and answering it from the Set would mean N lookups
// or a second join every caller writes itself.
//
// Ordered followed_at DESC, the order idx_user_team_follows_user was built
// for. Note followedGroup() deliberately takes the OLDEST follow instead:
// your first team is your team. The two orders are both correct and neither
// should be "fixed" to match the other.
// =============================================================================
export async function getFollowedTeams(userId) {
  if (userId == null) return [];
  const rows = await sql`
    SELECT t.id, t.slug, t.name, t.short_name, t.abbreviation,
           t.color_primary, t.color_secondary,
           l.slug AS league_slug, l.name AS league_name,
           f.followed_at
      FROM user_team_follows f
      JOIN teams t ON t.id = f.team_id
      LEFT JOIN leagues l ON l.id = t.league_id
     WHERE f.user_id = ${userId}
     ORDER BY f.followed_at DESC
  `;
  return rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.short_name ?? r.name, fullName: r.name,
    abbreviation: r.abbreviation ?? null,
    colors: { primary: r.color_primary ?? null, secondary: r.color_secondary ?? null },
    leagueSlug: r.league_slug ?? null, leagueName: r.league_name ?? null,
    followedAt: r.followed_at,
  }));
}

// =============================================================================
// followableTeams() — every team a reader could follow, for the add control.
//
// SCOPED TO THE LEAGUES THE SITE ACTUALLY COVERS. teams holds rows for
// leagues with no surface at all, and offering one is offering a follow that
// leads nowhere. The list is small enough (low thousands) to ship whole and
// filter in the browser; a search box that round-trips per keystroke on a
// list this size is latency bought with nothing.
// =============================================================================
export const FOLLOWABLE_LEAGUES = Object.freeze(['nfl', 'cfb', 'epl', 'fifa-wc-2026']);

export async function followableTeams(leagues = FOLLOWABLE_LEAGUES) {
  const rows = await sql`
    SELECT t.id, t.slug, t.name, t.short_name, t.abbreviation, l.slug AS league_slug, l.name AS league_name
      FROM teams t
      JOIN leagues l ON l.id = t.league_id
     WHERE l.slug = ANY(${[...leagues]})
     ORDER BY l.slug ASC, t.name ASC
  `;
  return rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.short_name ?? r.name, fullName: r.name,
    abbreviation: r.abbreviation ?? null,
    leagueSlug: r.league_slug, leagueName: r.league_name,
  }));
}
