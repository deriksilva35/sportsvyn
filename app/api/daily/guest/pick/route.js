/**
 * POST /api/daily/guest/pick - one step of a SIGNED-OUT Daily run (the lock-in, mon-4).
 *
 * The guest twin of /api/daily/board/pick: the signed start token must name this
 * device's own guest run, and the same rules apply (lib/daily/lockIn.js) -
 * a player only from the committed team, into an open slot, final.
 */
import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { GUEST_COOKIE, verifyDevice, verifyStartToken } from '@/lib/daily/guestRuns';
import { pickStep } from '@/lib/daily/lockIn';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  if (session?.user?.id != null) return Response.json({ error: 'signed in' }, { status: 409 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const tok = verifyStartToken(body?.token);
  const deviceId = verifyDevice((await cookies()).get(GUEST_COOKIE)?.value);
  if (!tok || !deviceId || tok.deviceId !== deviceId) return Response.json({ error: 'bad token' }, { status: 401 });
  const who = { boardId: tok.boardId, runId: tok.runId, deviceId };
  const r = await pickStep(sql, who, body?.slotIndex, body?.playerName);
  if (!r.ok) return Response.json({ error: r.reason }, { status: r.status ?? 400 });
  return Response.json(r);
}
