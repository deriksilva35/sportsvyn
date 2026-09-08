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
 * THE RESPONSE CARRIES NO BOARD. v1's /start hands back a stripped board
 * because v1 hides the answer; v2's board is already rendered by the server
 * component on the page (its whole premise is that the cards are public and
 * the clock is the game). So this route is the clock alone: startedAt and the
 * edition's closesAt, both server-issued, neither trusted back - submitRun
 * re-reads the stored row and re-checks the close itself.
 */
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { startRun } from '@/lib/daily/seasonBoardRuns';
import { ensureBoardForDate, isEditionLive, effectiveEpoch } from '@/lib/daily/seasonBoardEditions';
import { todayEt } from '@/lib/daily/entries';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const editionDate = await todayEt();
  if (!isEditionLive(editionDate, effectiveEpoch())) {
    return Response.json({ error: 'no edition' }, { status: 404 });
  }
  const board = await ensureBoardForDate(sql, editionDate);

  const r = await startRun(sql, { boardId: board.id, userId: Number(userId) });
  if (!r.ok) return Response.json({ error: r.reason }, { status: r.status ?? 400 });

  return Response.json({
    editionDate,
    boardId: board.id,
    startedAt: r.startedAt,
    closesAt: r.closesAt,
    resumed: r.resumed,
    submitted: r.submitted,
  });
}
