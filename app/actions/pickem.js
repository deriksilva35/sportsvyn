'use server';

// app/actions/pickem.js - save-on-change for the living board. The action is
// a thin door: auth, then lib/pickem/entry owns every rule (the per-game
// lock included - the server clock is the only clock).

import { auth } from '@/auth';
import { savePick } from '@/lib/pickem/entry';

export async function savePickAction(contestId, matchId, side) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  return savePick(Number(userId), Number(contestId), Number(matchId), side);
}
