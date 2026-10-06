/**
 * POST /api/daily/guest/run - submit a signed-out run.
 *
 * Graded server-side from picks only (never a client score), exactly as
 * /api/daily/board/run does for a signed-in run. The signed start token must
 * name this device's own guest run. The answer is the OPEN-DAY reveal - own
 * slots, total and "you beat X%" against finished real runs - never the grade:
 * the guest is on no board, so no rank, and the best roster stays sealed until
 * midnight like everyone else's.
 */
import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { GUEST_COOKIE, verifyDevice, verifyStartToken, submitGuestRun, guestRevealFor } from '@/lib/daily/guestRuns';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  if (session?.user?.id != null) return Response.json({ error: 'signed in' }, { status: 409 });

  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const tok = verifyStartToken(body?.token);
  const deviceId = verifyDevice((await cookies()).get(GUEST_COOKIE)?.value);
  if (!tok || !deviceId || tok.deviceId !== deviceId) return Response.json({ error: 'bad token' }, { status: 401 });

  const r = await submitGuestRun(sql, { runId: tok.runId, boardId: tok.boardId, deviceId, picks: body?.picks });
  if (!r.ok) return Response.json({ error: r.reason }, { status: r.status ?? 400 });
  const reveal = await guestRevealFor(sql, { board: r.board, run: r.run });
  return Response.json({ ok: true, open: true, reveal, score: Number(r.run.score), elapsedS: Number(r.run.elapsed_s) });
}
