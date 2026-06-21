/**
 * /api/cron/publish-player-edition -- Vercel cron target.
 * Schedule: "0 12 * * *" (5am PDT = 12:00 UTC; WC summer-only).
 *
 * Auth: Bearer ${CRON_SECRET} (same secret as the other crons).
 *
 * Calls publishPlayerEditionDaily on the player-power list for fifa-wc-2026.
 * The orchestrator HOLDs on live matches / cooldown / drift instability;
 * NO-OPs when no new finals since the prior edition; otherwise publishes
 * a new edition (board + entries, atomic) and queues top-10 ranking_row_blurb
 * drafts to /admin/blurbs for editor review. NEVER auto-approves blurbs.
 *
 * Debugging:
 *   ?dry=1   read-only run; returns the board that WOULD publish without
 *            writing. CRON_SECRET still required.
 *
 * Response shape: see publishPlayerEditionDaily return value (action,
 * new_ed_id?, edition_label?, drafts_queued?, snap_before/after,
 * timing_ms, dryRun).
 */

import { sql } from '@/lib/db';
import { publishPlayerEditionDaily } from '@/lib/rankings/playerEditionScheduler';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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

  let result;
  try {
    result = await publishPlayerEditionDaily({
      sql,
      leagueSlug: 'fifa-wc-2026',
      listSlug:   'player-power',
      dryRun,
    });
  } catch (err) {
    return Response.json({
      action: 'error',
      message: String(err?.message ?? err),
      stack:   err?.stack ?? null,
    }, { status: 500 });
  }

  return Response.json(result);
}
