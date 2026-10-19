/**
 * /api/me/morning-email - the reader's own Morning email switch (ruling thu-1).
 * PUT { on: boolean } -> { ok, on }. ON mails them every morning even when
 * dormant; OFF never mails them, whatever the 30-day / 14-day rule says.
 * Their own row only; the age gate first, like every write.
 */
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { ageGateResponse } from '@/lib/auth/ageGateDb';

export const dynamic = 'force-dynamic';

export async function PUT(request) {
  const session = await auth();
  const userId = session?.user?.id == null ? null : Number(session.user.id);
  if (userId == null) return Response.json({ ok: false, reason: 'Sign in first' }, { status: 401 });
  const gated = await ageGateResponse(userId); if (gated) return gated;
  const body = await request.json().catch(() => null);
  if (typeof body?.on !== 'boolean') return Response.json({ ok: false, reason: 'on must be true or false' }, { status: 400 });
  const rows = await sql`UPDATE users SET morning_email = ${body.on} WHERE id = ${userId} RETURNING morning_email`;
  return Response.json(rows.length ? { ok: true, on: rows[0].morning_email } : { ok: false, reason: 'Could not save that' });
}
