/**
 * POST /api/push/unregister - revoke this device's token.
 *
 * REVOKED, NEVER DELETED: when the token died is a debugging fact worth
 * keeping, and re-registering revives the same row (see register). Authed to
 * match register; scoped to the token itself because the device asking is the
 * device being silenced - user_id is not consulted, so a token registered
 * under an earlier account can still be shut off by whoever holds the device.
 */

import { auth } from '@/auth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const session = await auth();
  if (session?.user?.id == null) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const token = String(body?.token ?? '').trim();
  if (!token) return Response.json({ error: 'bad token' }, { status: 400 });

  await sql`UPDATE device_tokens SET revoked_at = now() WHERE token = ${token}`;
  return Response.json({ ok: true });
}
