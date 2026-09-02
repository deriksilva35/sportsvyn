/**
 * POST /api/client-error — a client render failure, written where we can see it.
 *
 * WHY THIS EXISTS. app/sim/draft/[id]/error.js caught room render errors and
 * reported them to console.error and nowhere else. That is invisible to us: the
 * boundary only catches CLIENT re-renders after hydration, so the page itself
 * served 200 and every server-side log read clean while the room was unusable.
 * Measured 2 Sep 2026 — the college board threw a TypeError on 101 of the first
 * 120 rows it rendered, Vercel's runtime errors reported "none in range", and
 * the only reason it was found at all is that the reader described the screen.
 * A failure we cannot see is a failure we cannot fix.
 *
 * IT WRITES TO sync_runs, the house ledger, because that is already the place a
 * failure goes to be found — the same table that surfaced the adp-snapshot cron
 * throwing for a day. source='client-error', kind='room-render', ok=false, so
 * the existing "what broke recently" query finds these without being taught a
 * new table.
 *
 * SIGNED-IN ONLY, and that is the abuse control rather than a rate limiter: the
 * draft room is behind auth, so a genuine report always has a session, and an
 * anonymous POST has nothing to gain. A signed-out caller gets 204 and no row.
 *
 * EVERYTHING IS CAPPED AND NOTHING IS TRUSTED. message, digest, path and stack
 * are attacker-controlled strings from a client; each is coerced and truncated
 * before it goes near the database, and the row is a jsonb summary rather than
 * columns, so a long stack cannot fail an insert or reshape the table.
 *
 * IT NEVER THROWS BACK AT THE BOUNDARY. The error screen's job is to show the
 * reader a way out; a reporting endpoint that 500s while being told about a
 * crash would replace one invisible failure with two. Always 204.
 */

import { auth } from '@/auth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

const cap = (v, n) => (v == null ? null : String(v).slice(0, n));

export async function POST(request) {
  try {
    const session = await auth();
    const userId = session?.user?.id ?? null;
    if (!userId) return new Response(null, { status: 204 });

    const body = await request.json().catch(() => ({}));
    const summary = {
      message: cap(body?.message, 500),
      digest: cap(body?.digest, 100),
      path: cap(body?.path, 200),
      // The stack is the expensive half and the useful half. 4KB is enough for
      // the frames that name the component, and short enough that a flood of
      // reports cannot bloat the ledger.
      stack: cap(body?.stack, 4000),
      userAgent: cap(request.headers.get('user-agent'), 300),
    };
    await sql`
      INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary, error)
      VALUES ('client-error', 'room-render', now(), now(), false,
              ${JSON.stringify(summary)}::jsonb, ${summary.message})`;
  } catch {
    // Swallowed on purpose — see the header. The reader is already looking at an
    // error screen; this must not become a second one.
  }
  return new Response(null, { status: 204 });
}
