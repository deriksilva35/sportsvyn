/**
 * POST /api/daily/guest/start - a SIGNED-OUT reader's one play of today's board.
 *
 * Mirrors /api/daily/board/start: the row is written before the cards are
 * handed over, so the attempt is spent the moment they are seen and a reload
 * resumes the same clock. The row is a GUEST run (daily_guest_runs) - on no
 * board and in no count until a sign-in claims it (lib/daily/guestRuns.js).
 *
 * The device is the signed sv_gd cookie (minted here on first contact); the
 * response carries a signed start token the run route wants back. New starts
 * are capped per IP (429); a resume is free.
 */
import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { todayEt } from '@/lib/daily/entries';
import { ensureBoardForDate, isEditionLive, effectiveEpoch } from '@/lib/daily/seasonBoardEditions';
import { clientIp } from '@/lib/auth/rateLimit';
import {
  GUEST_COOKIE, GUEST_COOKIE_MAX_AGE_S, newDeviceId, signDevice, verifyDevice, signStartToken, startGuestRun,
} from '@/lib/daily/guestRuns';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  if (session?.user?.id != null) return Response.json({ error: 'signed in' }, { status: 409 });

  const editionDate = await todayEt();
  if (!isEditionLive(editionDate, effectiveEpoch())) return Response.json({ error: 'no edition' }, { status: 404 });
  const board = await ensureBoardForDate(sql, editionDate);

  const jar = await cookies();
  let deviceId = verifyDevice(jar.get(GUEST_COOKIE)?.value);
  const minted = deviceId == null;
  if (minted) deviceId = newDeviceId();

  const r = await startGuestRun(sql, { boardId: board.id, deviceId, ip: clientIp(request.headers) });
  if (!r.ok) return Response.json({ error: r.reason }, { status: r.status ?? 400 });
  // ONE PLAY PER DEVICE: a finished run gets no cards back, only the refusal.
  if (r.submitted) return Response.json({ error: 'already played' }, { status: 409 });

  if (minted) {
    jar.set(GUEST_COOKIE, signDevice(deviceId), {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: GUEST_COOKIE_MAX_AGE_S,
    });
  }
  return Response.json({
    editionDate, boardId: board.id, startedAt: r.run.started_at, closesAt: r.closesAt, resumed: r.resumed,
    submitted: false, teams: board.board, year: String(board.season_year),
    token: signStartToken({ runId: r.run.id, boardId: board.id, deviceId }),
  });
}
