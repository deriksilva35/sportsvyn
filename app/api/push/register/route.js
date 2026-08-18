/**
 * POST /api/push/register - a device announces its APNs token.
 *
 * AUTHED, because the register call only ever happens after OUR pre-warm
 * screen said yes, and that screen only renders signed-in. The row still
 * keeps user_id nullable (Skry's shape) because the token outlives sessions -
 * sign-out does not unregister the device, deletion nulls the column.
 *
 * REVIVE-IN-PLACE: APNs hands the same token string back to the same install,
 * so a user who disabled and re-enabled arrives here with a token we hold a
 * revoked row for. The upsert clears revoked_at rather than failing on the
 * primary key - that violation was the Skry's first push bug.
 */

import { auth } from '@/auth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

// A hex APNs token is 64 chars today, but Apple documents the format as
// opaque and variable - so the bound is generous and the charset strict.
const TOKEN_RE = /^[0-9a-fA-F]{16,512}$/;

export async function POST(request) {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ error: 'unauthenticated' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const token = String(body?.token ?? '').trim();
  if (!TOKEN_RE.test(token)) return Response.json({ error: 'bad token' }, { status: 400 });
  const platform = 'ios'; // the only client; the column exists for the day that changes

  await sql`
    INSERT INTO device_tokens (token, user_id, platform)
    VALUES (${token}, ${Number(userId)}, ${platform})
    ON CONFLICT (token) DO UPDATE
      SET user_id = EXCLUDED.user_id, last_seen_at = now(), revoked_at = NULL`;

  return Response.json({ ok: true });
}
