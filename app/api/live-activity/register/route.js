/**
 * POST /api/live-activity/register - an Activity announces its push token.
 *
 * THE CONTRACT (LIVE ACTIVITY TOKENS AND UPDATES):
 *   { activityId, pushToken, matchId, startedAt }
 *   200 {ok:true} · 401 signed out · 400 malformed
 * Not one field more. Everything this route knows about the shape lives in
 * parseRegister() next door, so the app and the server can be read against
 * each other in one place.
 *
 * AUTHED, like /api/push/register and for the same reason: an Activity is
 * started from a screen that only renders signed in. The row's user_id is
 * still nullable, because an Activity outlives the session that started it.
 *
 * CALLED MORE THAN ONCE PER ACTIVITY, BY DESIGN. Activity.pushTokenUpdates is
 * a stream: the app re-registers whenever Apple reissues, and the upsert
 * behind this route updates in place rather than collecting duplicates.
 */

import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { parseRegister, registerActivity } from '@/lib/push/liveActivityStore';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const parsed = parseRegister(body);
  if (!parsed.ok) return Response.json({ error: parsed.reason }, { status: 400 });

  try {
    await registerActivity(sql, { ...parsed.value, userId: Number(userId) });
  } catch (e) {
    // THE ONE ERROR WORTH TELLING APART: match_id has a foreign key, so an
    // Activity for a match this database has never heard of is a 400 (the
    // app sent a bad id), not a 500 (we broke).
    const msg = String(e?.message ?? e);
    if (/live_activities_match_id_fkey|violates foreign key/i.test(msg)) {
      return Response.json({ error: 'unknown matchId' }, { status: 400 });
    }
    throw e;
  }

  return Response.json({ ok: true });
}
