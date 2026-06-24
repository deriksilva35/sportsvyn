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
//   { ok: true,  following: true | false }

async function lookupTeamSlug(teamId) {
  if (!Number.isInteger(teamId) || teamId <= 0) return null;
  const rows = await sql`SELECT slug FROM teams WHERE id = ${teamId} LIMIT 1`;
  return rows[0]?.slug ?? null;
}

export async function followTeam(teamId) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  if (!Number.isInteger(teamId) || teamId <= 0) {
    return { ok: false, reason: 'team_not_found' };
  }

  const slug = await lookupTeamSlug(teamId);
  if (!slug) return { ok: false, reason: 'team_not_found' };

  // INSERT is idempotent. A second follow on an already-followed team
  // is a no-op via the (user_id, team_id) PK conflict. We still
  // revalidate so a stale render that thought it was unfollowed
  // refreshes to the current truth.
  await sql`
    INSERT INTO user_team_follows (user_id, team_id)
    VALUES (${userId}, ${teamId})
    ON CONFLICT (user_id, team_id) DO NOTHING
  `;
  revalidatePath(`/team/${slug}`);
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
