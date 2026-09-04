/**
 * POST /api/daily/board/run — submit a completed v2 board run.
 *
 * GRADED SERVER-SIDE, ALWAYS. The request carries picks (slotIndex, teamKey,
 * playerName) and elapsedS - never a score. Every pick is re-validated
 * against the stored board's own frozen card before anything is scored
 * (lib/daily/seasonBoardRuns.js); a client that lied about a pick is refused
 * before grading, not merely out-scored.
 *
 * ONE RUN PER USER PER BOARD (090's UNIQUE constraint) - a repeat submit for
 * a board already run is refused with 409, never overwritten. SETTLED IS
 * FINAL.
 */
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { SLOTS } from '@/lib/daily/boardShape';
import { submitRun } from '@/lib/daily/seasonBoardRuns';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const boardId = Number(body?.boardId);
  if (!Number.isInteger(boardId)) return Response.json({ error: 'boardId required' }, { status: 400 });

  const r = await submitRun(sql, {
    boardId, userId: Number(userId), picks: body?.picks, elapsedS: Number(body?.elapsedS) || 0, slots: SLOTS,
  });
  if (!r.ok) return Response.json({ error: r.reason }, { status: r.status ?? 400 });
  return Response.json({
    ok: true, score: Number(r.run.score), pct: Number(r.run.pct), matched: r.run.matched,
  });
}
