/**
 * /api/cron/map-ko-fixtures — "Path A" daily re-poll.
 *
 * Runs lib/mapKoFixtures.js: maps API-Sports fixture ids onto our seeded
 * knockout rows (matched by stage + team api ids) so poll-live/syncFixture can
 * pull their results. Idempotent — re-runs daily so R16/QF/SF/Final get mapped
 * as their teams resolve through the tournament.
 *
 * Bearer CRON_SECRET. ?dry=1 returns the proposed mapping without writing.
 * force-dynamic (never cached).
 */

import { mapKoFixtures } from '@/lib/mapKoFixtures';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get('dry') === '1';

  try {
    const result = await mapKoFixtures({ dryRun });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { action: 'error', message: String(err?.message ?? err) },
      { status: 500 },
    );
  }
}
