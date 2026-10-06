/**
 * POST /api/daily/board/start — claim today's attempt and stamp the clock.
 *
 * MIRRORS v1's /api/daily/start (app/api/daily/start/route.js) in shape and in
 * purpose: the row is written BEFORE the board is playable, so the attempt is
 * spent the moment the cards are seen, and a reload resumes the SAME deadline
 * rather than buying a fresh clock. Until 097 v2 wrote nothing at start at all,
 * which made "One attempt - this board is ranked" true only for a player who
 * did not reload.
 *
 * THE RESPONSE CARRIES THE BOARD (1b, 27 Sep; this used to say the opposite).
 * v2's cards were rendered by the page from the first visit, so the board
 * could be solved off the payload before Start. Now the page sends team keys
 * only and the cards arrive here, after the row is written. startedAt and
 * closesAt are server-issued and never trusted back - submitRun re-reads the
 * stored row and re-checks the close itself.
 */
import { cookies } from 'next/headers';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { startRun } from '@/lib/daily/seasonBoardRuns';
import { ensureBoardForDate, isEditionLive, effectiveEpoch } from '@/lib/daily/seasonBoardEditions';
import { todayEt } from '@/lib/daily/entries';
import { ageGateResponse } from '@/lib/auth/ageGateDb';
import { readViewerTz } from '@/lib/gridiron/serverTz';
import { stampRunTz } from '@/lib/daily/morningPush';
import { GUEST_COOKIE, verifyDevice, guestBlocksStart } from '@/lib/daily/guestRuns';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const ageRefused = await ageGateResponse(userId); if (ageRefused) return ageRefused;

  const editionDate = await todayEt();
  if (!isEditionLive(editionDate, effectiveEpoch())) {
    return Response.json({ error: 'no edition' }, { status: 404 });
  }
  const board = await ensureBoardForDate(sql, editionDate);

  // A DEVICE THAT ALREADY PLAYED THIS BOARD AS A GUEST has seen the cards: no
  // second attempt by signing in and pressing Start. A finished guest run is
  // claimed here (the page does it on load); anything else is refused.
  const blocked = await guestBlocksStart(sql, {
    boardId: board.id, deviceId: verifyDevice((await cookies()).get(GUEST_COOKIE)?.value), userId: Number(userId),
  });
  if (blocked?.claimed) return Response.json({ error: 'claimed your guest run' }, { status: 409 });
  if (blocked?.blocked) return Response.json({ error: 'played as guest' }, { status: 409 });

  const r = await startRun(sql, { boardId: board.id, userId: Number(userId) });
  if (!r.ok) return Response.json({ error: r.reason }, { status: r.status ?? 400 });

  // THE READER'S ZONE, ON THE RUN (migration 129): the morning-after push goes
  // out at 9:00 AM there (lib/daily/morningPush.js). Best-effort and once - a
  // missing cookie or a pre-129 table leaves the run on ET.
  await stampRunTz(sql, { boardId: board.id, userId: Number(userId), tz: await readViewerTz() });

  // THE CARDS, NOW AND ONLY NOW (1b item 4, 27 Sep). The page no longer
  // renders them before a start is recorded (lib/daily/openReveal.js
  // sealedTeams), so this response is where they come from: the row above
  // exists, the attempt is spent, and the clock is running.
  return Response.json({
    editionDate,
    boardId: board.id,
    startedAt: r.startedAt,
    closesAt: r.closesAt,
    resumed: r.resumed,
    submitted: r.submitted,
    teams: board.board,
    // AND THE SEASON, withheld from the page with the cards for the same reason.
    year: String(board.season_year),
  });
}
