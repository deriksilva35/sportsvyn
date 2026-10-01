'use server';

/**
 * app/actions/leagues.js - create and join, the two writes a league needs.
 *
 * Both fail soft with a sentence: a league form must never strand somebody
 * mid-group-chat with a stack trace. Validation lives in lib/leagues/core -
 * these are auth + delegation.
 *
 * JOIN IS BY CODE ONLY - there is no join-by-league-id action. League ids are
 * serial; a join keyed on one lets anybody walk into every league.
 */

import { auth } from '@/auth';
import { createLeague, joinLeague } from '@/lib/leagues/core';

async function uid() {
  const session = await auth();
  const id = session?.user?.id ?? null;
  return id == null ? null : Number(id);
}

export async function createLeagueAction(formData) {
  const userId = await uid();
  if (userId == null) return { ok: false, reason: 'Sign in first' };
  try {
    return await createLeague(userId, formData.get('name'));
  } catch {
    return { ok: false, reason: 'Could not create the league' };
  }
}

export async function joinLeagueAction(formData) {
  const userId = await uid();
  if (userId == null) return { ok: false, reason: 'Sign in first' };
  try {
    return await joinLeague(userId, formData.get('code'));
  } catch {
    return { ok: false, reason: 'Could not join' };
  }
}
