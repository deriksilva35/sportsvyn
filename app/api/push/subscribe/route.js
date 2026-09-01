// /api/push/subscribe — register (or revive) this browser's endpoint.
//
// THE ENDPOINT IS THE IDENTITY, and registration is idempotent because a
// browser that re-subscribes returns the same URL. Piling up duplicate rows
// would mean one notification per duplicate.
//
// SIGNED-IN ONLY. An alert is addressed to a person, and a device with no user
// has nobody to resolve follows for.

import { auth } from '@/auth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  if (!userId) return Response.json({ error: 'sign-in required' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const { endpoint, keys } = body ?? {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return Response.json({ error: 'endpoint and keys required' }, { status: 400 });
  }

  const ua = request.headers.get('user-agent')?.slice(0, 300) ?? null;
  // ONE DEVICE TABLE, AND 070'S SHAPE IS KEPT WHOLE. The endpoint goes into
  // BOTH `token` - the primary key every existing revoke, revive and fan-out
  // query joins on - and `endpoint`, which is what the web sender posts to.
  // That is what lets a web row travel every path an iOS row already travels
  // instead of needing a parallel one.
  //
  // REVIVE-IN-PLACE, exactly as /api/push/register does it: the reader is
  // standing in front of the browser asking for alerts, and a revoked_at from a
  // stale endpoint three weeks ago must not silently keep them off.
  await sql`
    INSERT INTO device_tokens (token, user_id, platform, endpoint, p256dh, auth, user_agent)
    VALUES (${endpoint}, ${userId}, 'web', ${endpoint}, ${keys.p256dh}, ${keys.auth}, ${ua})
    ON CONFLICT (token) DO UPDATE
      SET user_id = EXCLUDED.user_id, endpoint = EXCLUDED.endpoint,
          p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
          user_agent = EXCLUDED.user_agent,
          last_seen_at = now(), revoked_at = NULL`;
  return Response.json({ ok: true });
}

export async function DELETE(request) {
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  if (!userId) return Response.json({ error: 'sign-in required' }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  if (!body?.endpoint) return Response.json({ error: 'endpoint required' }, { status: 400 });
  await sql`UPDATE device_tokens SET revoked_at = now()
             WHERE token = ${body.endpoint} AND user_id = ${userId}`;
  return Response.json({ ok: true });
}
