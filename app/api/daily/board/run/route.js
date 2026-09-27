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

import { submitRun, regradeStoredRun } from '@/lib/daily/seasonBoardRuns';
import { openRevealFor } from '@/lib/daily/openReveal';
import { todayEt } from '@/lib/daily/entries';

export const dynamic = 'force-dynamic';

/**
 * WHILE THE DAY IS OPEN THE RESPONSE IS THE REVEAL, NOT THE GRADE (1b). The
 * grade's rows carry the best roster, and a response is as public as a page:
 * before closes_at the client gets its own slots, total, rank, beat-%, streak
 * and the board of finished runs (lib/daily/openReveal.js), and nothing else.
 * Returns null once the board has closed - then the grade is the answer.
 */
async function openResponse(boardId, userId) {
  const [board] = await sql`SELECT *, now() < closes_at AS open FROM daily_boards WHERE id = ${boardId}`;
  if (!board || board.open !== true) return null;
  const [run] = await sql`
    SELECT * FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${userId} AND picks IS NOT NULL`;
  if (!run) return null;
  const reveal = await openRevealFor(sql, { board, run, userId, editionDate: await todayEt() });
  return Response.json({ ok: true, open: true, reveal, score: Number(run.score), elapsedS: Number(run.elapsed_s) });
}

export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const boardId = Number(body?.boardId);
  if (!Number.isInteger(boardId)) return Response.json({ error: 'boardId required' }, { status: 400 });

  const r = await submitRun(sql, {
    boardId, userId: Number(userId), picks: body?.picks, elapsedS: Number(body?.elapsedS) || 0,
  });
  if (!r.ok) {
    // ALREADY RAN IS NOT AN ERROR THE PLAYER CAN ACT ON - it means their run
    // is already stored, so the honest response is that run's grade, not a
    // message. The client renders it exactly as it renders a fresh submit.
    // Same shape, so the caller needs no second code path.
    if (r.reason === 'already ran this board') {
      const open = await openResponse(boardId, Number(userId));
      if (open) return open;
      const [board] = await sql`SELECT * FROM daily_boards WHERE id = ${boardId}`;
      const [row] = await sql`
        SELECT * FROM daily_board_runs WHERE board_id = ${boardId} AND user_id = ${Number(userId)}`;
      if (board && row?.picks) {
        const stored = regradeStoredRun(board, row.picks);
        if (stored.ok) {
          return Response.json({
            ok: true, alreadyRan: true, grade: stored.grade,
            score: Number(row.score), pct: Number(row.pct),
            matched: row.matched, elapsedS: Number(row.elapsed_s),
          });
        }
      }
    }
    return Response.json({ error: r.reason }, { status: r.status ?? 400 });
  }
  const open = await openResponse(boardId, Number(userId));
  if (open) return open;
  // THE WHOLE GRADE, NOT THREE NUMBERS. The grade screen renders rows, the
  // best roster, points-left and the glyph - if the route returned only
  // score/pct/matched the client would still have to compute the rest
  // itself, which is the client-side grading this change exists to remove.
  return Response.json({
    ok: true, grade: r.grade,
    score: Number(r.run.score), pct: Number(r.run.pct),
    matched: r.run.matched, elapsedS: Number(r.run.elapsed_s),
  });
}
