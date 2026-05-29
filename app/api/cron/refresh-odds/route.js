/**
 * /api/cron/refresh-odds — Vercel cron target. Schedule: every hour at :00.
 *
 * Auth: Bearer ${CRON_SECRET} (same secret as poll-live).
 *
 * Daily-baseline approach (in-route, no separate cron, no meta table):
 *   - The hourly cron run normally refreshes current values and computes
 *     movement_24h_* = current - baseline. The baseline (previous_*) is
 *     preserved across hourly runs.
 *   - At the 00:00 UTC run, the route flips stampBaseline=true for every
 *     match in the window. That copies new current values into previous_*
 *     and sets previous_snapshot_at = now(), establishing today's
 *     reference point.
 *   - An admin override `?baseline=1` query param forces baseline-stamp
 *     mode regardless of hour. The cron itself never passes this; it's
 *     for manual testing through the route. Same auth gate applies.
 *
 * Per-match isolation: each upsertMatchWinnerOdds call is wrapped in its
 * own try/catch so one fixture failing can't abort the others. A
 * {priced: false} return is NOT an error — it's the canonical
 * "aggregator hasn't priced this yet" outcome, counted as skipped_unpriced
 * and writes zero rows.
 *
 * Response shape:
 *   { refreshed, skipped_unpriced, errors,
 *     baseline_stamped, matches_in_window,
 *     error_details? }
 */

import { getMatchesToRefreshOdds } from '@/lib/oddsMatches';
import { upsertMatchWinnerOdds } from '@/lib/odds';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(request.url);
  const forceBaseline = url.searchParams.get('baseline') === '1';
  const stampBaseline = forceBaseline || new Date().getUTCHours() === 0;

  const matches = await getMatchesToRefreshOdds();

  if (matches.length === 0) {
    return Response.json({
      refreshed: 0,
      skipped_unpriced: 0,
      errors: 0,
      baseline_stamped: stampBaseline,
      matches_in_window: 0,
    });
  }

  let refreshed = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails = [];

  for (const m of matches) {
    const apiId = Number(m.api_sports_id);
    if (!Number.isInteger(apiId) || apiId <= 0) {
      errors++;
      errorDetails.push({ id: m.id, error: 'invalid api_sports id' });
      continue;
    }
    try {
      const result = await upsertMatchWinnerOdds(m.id, apiId, { stampBaseline });
      if (result.priced) refreshed++;
      else skipped++;
    } catch (err) {
      errors++;
      errorDetails.push({ id: m.id, error: String(err?.message ?? err) });
    }
  }

  return Response.json({
    refreshed,
    skipped_unpriced: skipped,
    errors,
    baseline_stamped: stampBaseline,
    matches_in_window: matches.length,
    ...(errors > 0 ? { error_details: errorDetails } : {}),
  });
}
