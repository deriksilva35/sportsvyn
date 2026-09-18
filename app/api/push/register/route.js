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
import { canRevive, STRIKE_LIMIT } from '@/lib/push/tokenHealth';

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
  // The client's VERIFIED checkPermissions result (072). Constrained to the
  // states the plugin can actually report; anything else stores as null -
  // unknown is honest, an invented state is not.
  const permission = ['granted', 'denied', 'prompt', 'prompt-with-rationale']
    .includes(body?.permission) ? body.permission : null;

  // REVIVE-IN-PLACE IS NOW CONDITIONAL, AND THIS IS THE WHOLE FIX.
  //
  // The unconditional `revoked_at = NULL` in the upsert below cost three days of
  // silence (15-18 Sep 2026): APNs rejected his token on every event, every
  // sender dutifully revoked it, and every app launch brought it back. The
  // loop was invisible because revoked_at holds one timestamp and a token
  // that dies nightly looks exactly like one that died once.
  //
  // A token that has struck out stays dead. The DEVICE is not blocked: APNs
  // issues a NEW token string on reinstall or re-permission, and that is a new
  // row at zero strikes - which is precisely how the incident ended, at 01:15
  // on 18 Sep, when a fresh token registered and took every push after it.
  const [existing] = await sql`SELECT strikes, revoked_at FROM device_tokens WHERE token = ${token} LIMIT 1`;
  if (!canRevive(existing)) {
    return Response.json({
      ok: false,
      reason: 'token_rejected',
      // THE APP IS TOLD WHAT TO DO ABOUT IT, not merely that it failed. A
      // client that knows this token is finished can ask iOS for a new one.
      detail: `APNs rejected this token ${existing.strikes} times in a row`,
      strikes: existing.strikes,
      limit: STRIKE_LIMIT,
    }, { status: 200 });
  }

  await sql`
    INSERT INTO device_tokens (token, user_id, platform, permission)
    VALUES (${token}, ${Number(userId)}, ${platform}, ${permission})
    ON CONFLICT (token) DO UPDATE
      SET user_id = EXCLUDED.user_id, last_seen_at = now(), revoked_at = NULL,
          permission = EXCLUDED.permission`;

  return Response.json({ ok: true });
}
