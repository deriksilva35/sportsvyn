/**
 * POST /api/weekly/save - save-on-change for a weekly lineup.
 *
 * THE LOCK IS CHECKED HERE, against locks_at read from the contest row, and a
 * save that arrives after it is refused however good the lineup is. The
 * builder's countdown has no standing - same posture as the Daily's clock.
 *
 * PARTIAL SAVES ARE THE NORMAL CASE. This endpoint is called on every pick
 * across five days, so most calls carry an incomplete lineup. Completeness is
 * asked at settle.
 */
import { auth } from '@/auth';
import { currentContest, saveLineup } from '@/lib/weekly/entries';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }

  const contest = await currentContest();
  if (!contest) return Response.json({ error: 'no board' }, { status: 404 });
  if (contest.settled) return Response.json({ error: 'settled' }, { status: 409 });

  const r = await saveLineup(contest.id, Number(userId), body?.lineup);
  if (!r.ok) {
    // 409 for a locked week: the client flips to the locked surface on this
    // exact code rather than showing an error it cannot act on.
    const status = r.reason === 'locked' ? 409 : 400;
    return Response.json({ error: r.reason, errors: r.errors }, { status });
  }
  return Response.json({ ok: true, filled: r.filled, savedAt: r.entry?.updated_at ?? null });
}
