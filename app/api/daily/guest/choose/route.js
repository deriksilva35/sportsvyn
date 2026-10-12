/**
 * POST /api/daily/guest/choose - one step of a SIGNED-OUT Daily run (the lock-in, mon-4).
 *
 * The guest twin of /api/daily/board/choose: the signed start token must name this
 * device's own guest run, and the same rules apply (lib/daily/lockIn.js) -
 * choosing a team commits the run and is the only way its card is seen.
 */
import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { GUEST_COOKIE, verifyDevice, verifyStartToken } from '@/lib/daily/guestRuns';
import { chooseStep } from '@/lib/daily/lockIn';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  if (session?.user?.id != null) return Response.json({ error: 'signed in' }, { status: 409 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const tok = verifyStartToken(body?.token);
  const deviceId = verifyDevice((await cookies()).get(GUEST_COOKIE)?.value);
  if (!tok || !deviceId || tok.deviceId !== deviceId) return Response.json({ error: 'bad token' }, { status: 401 });
  const who = { boardId: tok.boardId, runId: tok.runId, deviceId };
  const r = await chooseStep(sql, who, body?.teamKey);
  if (!r.ok) return Response.json({ error: r.reason }, { status: r.status ?? 400 });
  return Response.json(r);
}
