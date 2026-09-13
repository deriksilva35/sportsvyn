'use server';

/**
 * Server Actions for the team follow spine.
 *
 * Two explicit actions (no toggle on purpose): the client knows the
 * current state from the rendered star, so the submit intent is
 * unambiguous. Both writes are idempotent — INSERT ... ON CONFLICT
 * DO NOTHING and DELETE are no-ops if the user is already in the
 * desired state, so a double-click can't corrupt anything.
 *
 * Auth is resolved INSIDE each action — userId is NEVER trusted from
 * the client. An unauthenticated call returns a typed result rather
 * than throwing or redirecting; the client decides whether to surface
 * a sign-in prompt.
 *
 * revalidatePath fires on success so the team page's server-rendered
 * follow state stays fresh after the round-trip. The team slug is
 * looked up server-side (we don't trust a slug from the client
 * either — though for revalidation the worst case would be a stale
 * cache, not a security issue).
 */

import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { revalidatePath } from 'next/cache';

// Same shape for both return values so the client can branch on .ok
// without remembering which action returned what.
//   { ok: false, reason: 'unauthenticated' }
//   { ok: false, reason: 'team_not_found' }
//   { ok: false, reason: 'cap_reached', cap, league }
//   { ok: true,  following: true | false }

/**
 * FIVE TEAMS PER LEAGUE, ENFORCED IN THE ACTION (RANKINGS TAB v2, R4).
 *
 * Not in the button. A cap that lives in one screen's markup is a cap the
 * next screen does not have, and there are six surfaces writing follows now -
 * the team page star, both game headers, the account list, the All-138 list
 * and whatever comes next. The refusal is here so every caller inherits it.
 *
 * PER LEAGUE, NOT IN TOTAL. Following five NFL teams should not cost you a
 * college team; they are different seasons on different days.
 *
 * A follow you ALREADY HOLD is never refused - re-following team you follow
 * is the idempotent no-op it has always been, and counting it against the cap
 * would make a double tap look like a limit.
 */
export const FOLLOW_CAP_PER_LEAGUE = 5;

async function lookupTeam(teamId) {
  if (!Number.isInteger(teamId) || teamId <= 0) return null;
  const rows = await sql`
    SELECT t.slug, t.league_id, l.slug AS league_slug
      FROM teams t LEFT JOIN leagues l ON l.id = t.league_id
     WHERE t.id = ${teamId} LIMIT 1`;
  return rows[0] ?? null;
}

async function lookupTeamSlug(teamId) {
  return (await lookupTeam(teamId))?.slug ?? null;
}

export async function followTeam(teamId) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return { ok: false, reason: 'team_not_found' };
  }

  const team = await lookupTeam(teamId);
  if (!team?.slug) return { ok: false, reason: 'team_not_found' };

  // THE CAP IS COUNTED WITHIN THIS TEAM'S LEAGUE, and only for a team the
  // reader does not already follow. A team with no league is uncapped rather
  // than unfollowable - it cannot be counted against a league it is not in.
  if (team.league_id != null) {
    const [c] = await sql`
      SELECT count(*)::int AS n
        FROM user_team_follows f
        JOIN teams t ON t.id = f.team_id
       WHERE f.user_id = ${userId} AND t.league_id = ${team.league_id}
         AND f.team_id <> ${teamId}`;
    if ((c?.n ?? 0) >= FOLLOW_CAP_PER_LEAGUE) {
      return {
        ok: false, reason: 'cap_reached',
        cap: FOLLOW_CAP_PER_LEAGUE, league: team.league_slug ?? null,
      };
    }
  }

  // INSERT is idempotent. A second follow on an already-followed team
  // is a no-op via the (user_id, team_id) PK conflict. We still
  // revalidate so a stale render that thought it was unfollowed
  // refreshes to the current truth.
  await sql`
    INSERT INTO user_team_follows (user_id, team_id)
    VALUES (${userId}, ${teamId})
    ON CONFLICT (user_id, team_id) DO NOTHING
  `;
  revalidatePath(`/team/${team.slug}`);
  return { ok: true, following: true };
}

export async function unfollowTeam(teamId) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return { ok: false, reason: 'team_not_found' };
  }

  const slug = await lookupTeamSlug(teamId);
  if (!slug) return { ok: false, reason: 'team_not_found' };

  // DELETE is idempotent — affecting zero rows when the user isn't
  // following is the same outcome.
  await sql`
    DELETE FROM user_team_follows
     WHERE user_id = ${userId} AND team_id = ${teamId}
  `;
  revalidatePath(`/team/${slug}`);
  return { ok: true, following: false };
}

// ============================================================================
// Player follows — exact mirror of the team actions above.
//   { ok: false, reason: 'unauthenticated' | 'player_not_found' }
//   { ok: true,  following: true | false }
// ============================================================================

async function lookupPlayerSlug(playerId) {
  if (!Number.isInteger(playerId) || playerId <= 0) return null;
  const rows = await sql`SELECT slug FROM players WHERE id = ${playerId} LIMIT 1`;
  return rows[0]?.slug ?? null;
}

export async function followPlayer(playerId) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return { ok: false, reason: 'player_not_found' };
  }

  const slug = await lookupPlayerSlug(playerId);
  if (!slug) return { ok: false, reason: 'player_not_found' };

  await sql`
    INSERT INTO user_player_follows (user_id, player_id)
    VALUES (${userId}, ${playerId})
    ON CONFLICT (user_id, player_id) DO NOTHING
  `;
  revalidatePath(`/player/${slug}`);
  return { ok: true, following: true };
}

export async function unfollowPlayer(playerId) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return { ok: false, reason: 'player_not_found' };
  }

  const slug = await lookupPlayerSlug(playerId);
  if (!slug) return { ok: false, reason: 'player_not_found' };

  await sql`
    DELETE FROM user_player_follows
     WHERE user_id = ${userId} AND player_id = ${playerId}
  `;
  revalidatePath(`/player/${slug}`);
  return { ok: true, following: false };
}
