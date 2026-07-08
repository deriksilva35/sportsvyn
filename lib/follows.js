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
