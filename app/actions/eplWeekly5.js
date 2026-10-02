'use server';

// app/actions/eplWeekly5.js - save-on-change for EPL Weekly 5. A thin door:
// auth, then lib/eplWeekly5/entry owns every rule. THE CLIENT SENDS A PLAYER ID
// AND NOTHING ELSE - the club, position and fixture are the database's.

import { auth } from '@/auth';
import { saveEpl5Pick, clearEpl5Pick } from '@/lib/eplWeekly5/entry';

export async function saveEplWeekly5PickAction(contestId, slot, playerId) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  return saveEpl5Pick(Number(userId), Number(contestId), String(slot), String(playerId));
}

export async function clearEplWeekly5PickAction(contestId, slot) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  return clearEpl5Pick(Number(userId), Number(contestId), String(slot));
}
