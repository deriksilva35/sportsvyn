'use server';

// app/actions/six.js - save-on-change for Tonight's Six. A thin door: auth,
// then lib/six/entry owns every rule (eligibility, the per-team cap, Out, and
// the rolling lock on each game's CURRENT tip - the server clock is the only
// clock). The client names a player and a game; everything else about him is
// looked up in the night's pool.

import { auth } from '@/auth';
import { saveSixPick, clearSixPick } from '@/lib/six/entry';

export async function saveSixPickAction(contestId, slot, player) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  return saveSixPick(Number(userId), Number(contestId), String(slot), {
    playerId: String(player?.playerId),
    matchId: Number(player?.matchId),
  });
}

export async function clearSixPickAction(contestId, slot) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  return clearSixPick(Number(userId), Number(contestId), String(slot));
}
