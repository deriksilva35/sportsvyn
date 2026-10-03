'use server';

/**
 * app/actions/leagues.js - the writes a league needs: create, join (by the
 * typed code or the link token), and the owner's invite reset.
 *
 * All fail soft with a sentence: a league form must never strand somebody
 * mid-group-chat with a stack trace. Validation lives in lib/leagues - these
 * are auth + delegation.
 *
 * JOIN IS BY CODE OR TOKEN ONLY - there is no join-by-league-id action. League
 * ids are serial; a join keyed on one lets anybody walk into every league.
 */

import { auth } from '@/auth';
import { createLeague, joinLeague } from '@/lib/leagues/core';
import { joinByInvite, resetInvite } from '@/lib/leagues/invite';
import { ageGateRefusal } from '@/lib/auth/ageGateDb';

async function uid() {
  const session = await auth();
  const id = session?.user?.id ?? null;
  return id == null ? null : Number(id);
}

/**
 * The create sheet (/leagues/new) is the ONLY way a league is made. The board
 * chips' name-only quick-create is gone (Derik, fri-2): a league without its
 * games, span and format is refused here rather than defaulted.
 */
export async function createLeagueAction(formData) {
  const userId = await uid();
  if (userId == null) return { ok: false, reason: 'Sign in first' };
  const ageRefused = await ageGateRefusal(userId); if (ageRefused) return ageRefused;
  if (!formData.has('span')) return { ok: false, reason: 'Make a league from the create sheet' };
  const settings = {
        games: formData.getAll('games').flatMap((g) => String(g).split(',')),
        span: formData.get('span'),
        scoring: formData.get('scoring'),
        format: formData.get('format'),
        dropWorst: formData.get('dropWorst'),
        maxMembers: formData.get('maxMembers'),
        lateJoins: formData.get('lateJoins'),
      };
  try {
    return await createLeague(userId, formData.get('name'), settings);
  } catch {
    return { ok: false, reason: 'Could not create the league' };
  }
}

export async function joinLeagueAction(formData) {
  const userId = await uid();
  if (userId == null) return { ok: false, reason: 'Sign in first' };
  const ageRefused = await ageGateRefusal(userId); if (ageRefused) return ageRefused;
  try {
    return await joinLeague(userId, formData.get('code'));
  } catch {
    return { ok: false, reason: 'Could not join' };
  }
}

/** /j/<key>'s JOIN tap. The key is the code or the token the link carried. */
export async function joinInviteAction(key) {
  const userId = await uid();
  if (userId == null) return { ok: false, reason: 'Sign in first' };
  const ageRefused = await ageGateRefusal(userId); if (ageRefused) return ageRefused;
  try {
    return await joinByInvite(userId, key);
  } catch {
    return { ok: false, reason: 'Could not join' };
  }
}

/** The owner's reset: a new code and a new link; the old ones stop working. */
export async function resetInviteAction(leagueId) {
  const userId = await uid();
  if (userId == null) return { ok: false, reason: 'Sign in first' };
  const ageRefused = await ageGateRefusal(userId); if (ageRefused) return ageRefused;
  try {
    return await resetInvite(userId, Number(leagueId));
  } catch {
    return { ok: false, reason: 'Could not reset the invite' };
  }
}
