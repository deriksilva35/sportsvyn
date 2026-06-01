/**
 * /api/match/[slug]/status — lightweight status read for the
 * KickoffWatcher client component.
 *
 * Reads our DB only (the poll-live cron keeps matches.status current);
 * no upstream API-Sports call, no DB writes, no auth. Returns the
 * minimum the watcher needs to decide whether to call router.refresh().
 *
 * force-dynamic so the route is never statically cached — every hit
 * sees fresh DB state (matches the /match/[slug] page itself).
 */

import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const { slug } = await params;
  const rows = await sql`
    SELECT status FROM matches WHERE slug = ${slug} LIMIT 1
  `;
  if (!rows[0]) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  return Response.json({ status: rows[0].status });
}
