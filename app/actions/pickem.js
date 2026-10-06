'use server';

// app/actions/pickem.js - save-on-change for the living board. The action is
// a thin door: auth, then lib/pickem/entry owns every rule (the per-game
// lock included - the server clock is the only clock).

import { auth } from '@/auth';
import { savePick, saveSheet } from '@/lib/pickem/entry';
import { ageGateRefusal } from '@/lib/auth/ageGateDb';

export async function savePickAction(contestId, matchId, side) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  const ageRefused = await ageGateRefusal(userId); if (ageRefused) return ageRefused;
  return savePick(Number(userId), Number(contestId), Number(matchId), side);
}

/** Confidence boards: the whole sheet - picks and ranks - in one call. */
export async function saveSheetAction(contestId, picks, ranks) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  const ageRefused = await ageGateRefusal(userId); if (ageRefused) return ageRefused;
  return saveSheet(Number(userId), Number(contestId), { picks, ranks });
}
