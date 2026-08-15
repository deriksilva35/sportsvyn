/**
 * POST /api/daily/start — issue today's board and stamp the clock.
 *
 * The response carries the board with scores and teams STRIPPED (publicBoard)
 * and a server-issued startedAt. That timestamp is not trusted back: /lock
 * reads the stored one. It is sent only so the client can draw a progress bar.
 */
import { auth } from '@/auth';
import { startEntry, todayEt } from '@/lib/daily/entries';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const date = await todayEt();
  const r = await startEntry(Number(userId), date);
  if (!r.ok) return Response.json({ error: r.reason }, { status: r.reason === 'already entered' ? 409 : 400 });
  return Response.json({ puzzleDate: date, startedAt: r.startedAt, resumed: r.resumed, board: r.board, closesAt: r.closesAt });
}
