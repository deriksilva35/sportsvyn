/**
 * GET /api/me - the signed-in reader's chrome facts. Today: the handle.
 *
 * EXISTS FOR THE HEADER CHIP. AppHeader is a client component mounted in the
 * ROOT layout, and the root layout must never call auth() or cookies() - that
 * is the trap that turned /privacy and /terms dynamic twice. So the chip asks
 * after mount instead, from the one component that needs it, and only in the
 * shell (the caller gates; this endpoint just answers).
 *
 * Returns 200 always - a signed-out reader gets { handle: null } rather than
 * a 401, because "who am I" having no answer is a normal state for chrome,
 * not an error to retry.
 */

import { auth } from '@/auth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (userId == null) return Response.json({ handle: null });
  const [row] = await sql`SELECT handle FROM users WHERE id = ${Number(userId)}`
    .catch(() => [null]);
  return Response.json({ handle: row?.handle ?? null });
}
