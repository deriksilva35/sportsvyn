/**
 * POST /api/live-activity/end - the app says this Activity is gone.
 *
 * THE CONTRACT (LIVE ACTIVITY TOKENS AND UPDATES):
 *   { activityId }
 *   200 {ok:true} · 401 signed out · 400 malformed
 *
 * THE SERVER ALSO ENDS ACTIVITIES ITSELF, at final. This route is the other
 * direction: the reader swiped the card away, or the app tore the Activity
 * down on its own, and the server would otherwise keep pushing at a lock
 * screen that is not listening.
 *
 * IDEMPOTENT AND NOT AN ORACLE. Ending an already-ended Activity, or an id
 * this account never registered, returns {ok:true} - a retry on a flaky
 * connection is the app doing the right thing, and a 404 here would tell any
 * signed-in caller which Activity ids exist. `ended` carries whether this
 * call is what actually stopped the pushes.
 */

import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { parseEnd, endActivity } from '@/lib/push/liveActivityStore';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = parseEnd(body);
  if (!parsed.ok) return Response.json({ error: parsed.reason }, { status: 400 });

  const { ended } = await endActivity(sql, { activityId: parsed.value.activityId, userId: Number(userId) });
  return Response.json({ ok: true, ended });
}
