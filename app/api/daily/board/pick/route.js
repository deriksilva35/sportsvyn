/**
 * POST /api/daily/board/pick - one step of a signed-in Daily run (the lock-in, mon-4).
 *
 * { boardId, slotIndex, playerName }: places a player from the committed team into an
 * open slot, FINALLY. Refused without a committed team, for a player off that
 * team's card, and for a slot already filled - a pick is never changed.
 * The rules live in lib/daily/lockIn.js.
 */
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { pickStep } from '@/lib/daily/lockIn';
import { ageGateResponse } from '@/lib/auth/ageGateDb';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const ageRefused = await ageGateResponse(userId); if (ageRefused) return ageRefused;
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const boardId = Number(body?.boardId);
  if (!Number.isInteger(boardId)) return Response.json({ error: 'boardId required' }, { status: 400 });
  const who = { boardId, userId: Number(userId) };
  const r = await pickStep(sql, who, body?.slotIndex, body?.playerName);
  if (!r.ok) return Response.json({ error: r.reason }, { status: r.status ?? 400 });
  return Response.json(r);
}
