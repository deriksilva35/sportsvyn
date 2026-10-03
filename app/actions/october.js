'use server';

// app/actions/october.js - save-on-change for the five-a-day card. The action
// is a thin door: auth, then lib/october/entry owns every rule (the rolling
// lock and the two-from-one-game cap included - the server clock is the only
// clock). THERE IS NO BURN in this game; the Run has one and keeps it.

import { auth } from '@/auth';
import { saveOctoberPick, clearOctoberPick } from '@/lib/october/entry';
import { ageGateRefusal } from '@/lib/auth/ageGateDb';

export async function saveOctoberPickAction(contestId, slot, player) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  const ageRefused = await ageGateRefusal(userId); if (ageRefused) return ageRefused;
  return saveOctoberPick(Number(userId), Number(contestId), String(slot), {
    playerId: String(player?.playerId),
    matchId: Number(player?.matchId),
    kind: String(player?.kind),
    name: player?.name ?? null,
  });
}

export async function clearOctoberPickAction(contestId, slot) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  const ageRefused = await ageGateRefusal(userId); if (ageRefused) return ageRefused;
  return clearOctoberPick(Number(userId), Number(contestId), String(slot));
}
