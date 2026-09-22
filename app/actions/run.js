'use server';

// app/actions/run.js - save-on-change for the nine. A thin door: auth, then
// lib/run/entry owns every rule (the round lock, the burn, the three-per-club
// cap and the alive-club check - the server clock is the only clock).

import { auth } from '@/auth';
import { saveRunPick, clearRunPick } from '@/lib/run/entry';

export async function saveRunPickAction(contestId, slot, player) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  return saveRunPick(Number(userId), Number(contestId), String(slot), {
    playerId: String(player?.playerId), teamId: Number(player?.teamId),
    kind: String(player?.kind), name: player?.name ?? null, team: player?.team ?? null,
  });
}

export async function clearRunPickAction(contestId, slot) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { ok: false, reason: 'signed_out' };
  return clearRunPick(Number(userId), Number(contestId), String(slot));
}
