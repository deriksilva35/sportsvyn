/**
 * POST /api/daily/lock — validate, score, write. THE CLOCK IS CHECKED HERE,
 * against the stored started_at, and a late lineup is refused however good it
 * is. The client's own timer has no standing.
 */
import { auth } from '@/auth';
import { lockEntry, todayEt } from '@/lib/daily/entries';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const date = await todayEt();
  const r = await lockEntry(Number(userId), date, body?.lineup);
  if (!r.ok) {
    const status = r.reason === 'already entered' ? 409 : r.reason === 'clock' ? 408 : 400;
    return Response.json({ error: r.reason, detail: r.detail, errors: r.errors }, { status });
  }
  return Response.json({ ok: true, baseScore: r.baseScore, droppedSlot: r.droppedSlot });
}
