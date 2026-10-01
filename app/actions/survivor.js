'use server';

/**
 * app/actions/survivor.js - pick this week's Survivor team.
 *
 * Auth + delegation only, the app/actions/leagues.js shape: the session is
 * resolved here, never trusted from the client, and every rule lives in
 * lib/survivor/pick.js (and, beneath it, lib/survivor/rules.js). Fails soft
 * with a refusal key the room turns into a sentence (rules.js REFUSALS).
 */

import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { makePick } from '@/lib/survivor/pick';

export async function pickSurvivorTeam(poolId, teamId) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  try {
    const res = await makePick(Number(userId), Number(poolId), Number(teamId), { now: new Date() });
    if (res.ok) revalidatePath('/survivor');
    return res;
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
