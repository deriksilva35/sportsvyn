'use server';

/**
 * Server Actions for LEAGUE SHARING (085) - membership, invites, franchises,
 * the league's mocks list.
 *
 * Same law as app/actions/sim.js: the session is resolved INSIDE the action,
 * never trusted from the client, and every write delegates to lib/fantasy/
 * leagueShare.js, which takes the user id explicitly and is tested against the
 * database. Nothing here touches draft_configs or draft_config_keepers - the
 * league's FACTS have one writer (lib/fantrax/import.js) and it is not a
 * server action. Members write their own membership row and their own runs'
 * hidden flag; owners additionally mint/revoke codes and kick.
 */

import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import {
  createInvite as createInviteFor, revokeInvites as revokeInvitesFor,
  redeemInvite as redeemInviteFor, claimFranchise as claimFranchiseFor,
  leaveLeague as leaveLeagueFor, kickMember as kickMemberFor,
  setRunHidden as setRunHiddenFor,
} from '@/lib/fantasy/leagueShare';

async function currentUserId() {
  const session = await auth();
  return session?.user?.id ?? null;
}

// Owner only: mint the league's live code (any prior live code is revoked).
export async function createInvite(configId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await createInviteFor(userId, Number(configId));
  if (res.ok) revalidatePath('/sim');
  return res;
}

// Owner only: no live code. The link in the group chat stops working now.
export async function revokeInvites(configId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await revokeInvitesFor(userId, Number(configId));
  if (res.ok) revalidatePath('/sim');
  return res;
}

// The friend's tap: join (idempotent) and, when a franchise was tapped, claim
// it. The code and the team id are the only inputs, both strings on the wire.
export async function redeemInvite(code, fantraxTeamId = null) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const team = fantraxTeamId == null || fantraxTeamId === '' ? null : String(fantraxTeamId);
  const res = await redeemInviteFor(userId, String(code ?? ''), team);
  if (res.ok) { revalidatePath('/sim'); revalidatePath(`/join/${String(code ?? '')}`); }
  return res;
}

// Any member: take a franchise, or null to release yours.
export async function claimFranchise(configId, fantraxTeamId = null) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const team = fantraxTeamId == null || fantraxTeamId === '' ? null : String(fantraxTeamId);
  const res = await claimFranchiseFor(userId, Number(configId), team);
  if (res.ok) revalidatePath('/sim');
  return res;
}

// Member only (an owner cannot leave their own league): the wrong-claim escape.
export async function leaveLeague(configId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await leaveLeagueFor(userId, Number(configId));
  if (res.ok) revalidatePath('/sim');
  return res;
}

// Owner only: remove a member; their franchise is free again.
export async function kickMember(configId, targetUserId) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await kickMemberFor(userId, Number(configId), Number(targetUserId));
  if (res.ok) revalidatePath('/sim');
  return res;
}

// Your own run, on or off the league's list.
export async function setRunHidden(draftId, hidden) {
  const userId = await currentUserId();
  if (userId == null) return { ok: false, reason: 'unauthenticated' };
  const res = await setRunHiddenFor(userId, Number(draftId), hidden === true);
  if (res.ok) revalidatePath('/sim');
  return res;
}
