/**
 * /api/cron/publish-team-edition -- Vercel cron target.
 * Schedule: "30 12 * * *" (5am PDT = 12:30 UTC; offset 30 min after the
 * player cron at 12:00 UTC to avoid LLM concurrency and keep log streams
 * separate). WC summer-only.
 *
 * Auth: Bearer ${CRON_SECRET} (same secret as the other crons).
 *
 * Calls publishTeamEditionDaily on the team-power list for fifa-wc-2026.
 * The orchestrator HOLDs on live matches / cooldown / drift instability;
 * NO-OPs when no new finals since the prior edition; otherwise publishes
 * a new edition (board + entries, atomic) and queues top-10 ranking_row_blurb
 * drafts to /admin/blurbs for editor review. NEVER auto-approves blurbs.
 *
 * Debugging:
 *   ?dry=1   read-only run; returns the board that WOULD publish without
 *            writing. CRON_SECRET still required.
 *
 * Response shape: see publishTeamEditionDaily return value (action,
 * new_ed_id?, edition_label?, drafts_queued?, snap_before/after,
 * timing_ms, dryRun).
 */

import { sql } from '@/lib/db';
import { publishTeamEditionDaily } from '@/lib/rankings/teamEditionScheduler';

export const dynamic = 'force-dynamic';
// 800s (Pro + Fluid Compute App-Router ceiling supports up to 1800s).
// Steady-state heavy-matchday case: ~16-24 teams re-scored at ~19s per
// LLM call = 304-456s. 300s left no margin for the "8 matches in a day"
// case; 800s covers any realistic day with room for envelope-SQL drift,
// and stays tight enough to catch a runaway-call-count regression before
// it burns unbounded LLM spend. The cold first-fire (48 teams unstamped =
// ~918s) is handled by a one-shot manual run, not the cron.
export const maxDuration = 800;

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
    result = await publishTeamEditionDaily({
      sql,
      leagueSlug: 'fifa-wc-2026',
      listSlug:   'team-power',
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
