'use server';

// The per-game Draft's two writes (thu-3 S1): take a seat, make a pick. Both go
// through lib/draftGame/room.js, which re-checks the lock, the turn and the
// board server-side; these only resolve who is asking.

import { auth } from '@/auth';
import { ageGateRefusal } from '@/lib/auth/ageGateDb';
import { startRoom, makePick } from '@/lib/draftGame/room';

async function reader() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return { refused: { ok: false, reason: 'signed_out' } };
  const ageRefused = await ageGateRefusal(userId);
  if (ageRefused) return { refused: ageRefused };
  return { userId: Number(userId) };
}

export async function startGameDraftAction(contestId) {
  const r = await reader();
  if (r.refused) return r.refused;
  return startRoom(r.userId, Number(contestId));
}

export async function pickGameDraftAction(contestId, playerId) {
  const r = await reader();
  if (r.refused) return r.refused;
  return makePick(r.userId, Number(contestId), Number(playerId));
}
