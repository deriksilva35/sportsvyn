/**
 * GET /api/session - who the header is drawn for, on a STATIC page.
 *
 * EXISTS FOR GlobalHeaderClient. /market and the 404 are prerendered, so they
 * cannot call auth(): the header asks after mount instead. /api/me answers the
 * app header's one question (the handle); the web header also labels the
 * reader and wears the MEMBER chip, so it needs the two facts GlobalHeaderServer
 * resolves - the session's email and the `sim` entitlement - plus the handle.
 *
 * 200 always; signed out is { user: null }, a normal state for chrome. NEVER
 * CACHED: the answer is one reader's, and a shared cache that stored it would
 * serve one reader's name in another's header.
 */

import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { getEntitlements } from '@/lib/membership';

export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ user: null, isMember: false }, { headers: PRIVATE });
  const [row, ent] = await Promise.all([
    sql`SELECT handle FROM users WHERE id = ${Number(userId)}`.then((r) => r[0] ?? null).catch(() => null),
    getEntitlements(userId).catch(() => null),
  ]);
  return Response.json({
    user: { email: session.user.email ?? null, handle: row?.handle ?? null },
    isMember: !!ent?.sim,
  }, { headers: PRIVATE });
}
