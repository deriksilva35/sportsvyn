/**
 * GET /api/daily/view?date=YYYY-MM-DD — the entered-state view, for the client
 * to refresh after a lock or a guess without a full page round trip.
 *
 * Returns the caller's OWN entry and a percentile band. Never another player's
 * score, never a name, never the board.
 */
import { auth } from '@/auth';
import { entryView, todayEt } from '@/lib/daily/entries';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const date = url.searchParams.get('date') || await todayEt();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: 'bad date' }, { status: 400 });
  return Response.json(await entryView(Number(userId), date));
}
