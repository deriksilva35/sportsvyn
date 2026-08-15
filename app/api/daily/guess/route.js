/**
 * POST /api/daily/guess — the season/week guess, applied to a LOCKED entry.
 *
 * The bonus percentage comes back; whether the guess was RIGHT does not. That
 * is a reveal-time fact - telling one player the season pre-close hands it to
 * everyone they talk to.
 */
import { auth } from '@/auth';
import { submitGuess, todayEt } from '@/lib/daily/entries';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });

  let body; try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const date = await todayEt();
  const r = await submitGuess(Number(userId), date, { season: body?.season, week: body?.week });
  if (!r.ok) return Response.json({ error: r.reason }, { status: r.reason === 'already guessed' ? 409 : 400 });
  return Response.json({ ok: true, bonusPct: r.bonusPct, score: r.score });
}
