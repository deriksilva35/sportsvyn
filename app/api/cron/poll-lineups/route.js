/**
 * /api/cron/poll-lineups — Vercel cron target. Schedule: every 10 minutes.
 *
 * Auth: Bearer ${CRON_SECRET} (same secret as poll-live + refresh-odds).
 *
 * Two-tier cadence inside ONE every-10-min cron entry:
 *   - Matches with kickoff > 60 min away:  fetch only when minutesNow === 0
 *                                          (one poll per hour, top of hour)
 *   - Matches with kickoff ≤ 60 min away:  fetch every run (every 10 min)
 *
 * The candidate window is "scheduled matches with kickoff in the next 12
 * hours" — lineups appear at most ~1–2 hours before kickoff, so a 12-hour
 * horizon catches the entire pre-publish lead-in without polling matches
 * days out (lineups would always be empty there, wasted API calls).
 *
 * A match drops out of the candidate set on its own once status flips
 * past 'scheduled' (poll-live's job) — no extra "stop polling after FT"
 * logic needed here.
 *
 * Per-match isolation: each syncMatchLineups call is wrapped in its own
 * try/catch so one fixture failing can't abort the others. {hadData:false}
 * is NOT an error — it's the canonical "API-Sports hasn't published this
 * yet" outcome, counted as skipped_no_data.
 *
 * Debugging:
 *   ?dry=1 → returns the per-match decision (would-fetch vs skip-far)
 *            without calling the API or writing rows. CRON_SECRET still
 *            required.
 *
 * Response shape:
 *   { candidates, fetched, written, skipped_far, skipped_no_data, errors,
 *     polled, [error_details], [dry_run] }
 */

import { sql } from '@/lib/db';
import { syncMatchLineups } from '@/lib/lineups';

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
  const dryRun = url.searchParams.get('dry') === '1';

  // Two-window candidate set:
  //   (A) Pre-kickoff: scheduled matches in the next 12h (existing behavior).
  //   (B) Post-kickoff grace: matches that just kicked off in the last 30 min
  //       AND don't yet have lineups in match_lineups. Covers the friendly-
  //       fixture case where API-Sports publishes lineups at or just after
  //       kickoff — without this, poll-lineups stops looking the moment
  //       kickoff_at < now() and lineups never reach the DB.
  //   Once a fixture has is_current=true lineup rows for both sides, the
  //   NOT EXISTS clause filters it out — no re-polling for matches already
  //   captured.
  const candidates = await sql`
    SELECT m.id,
           m.kickoff_at,
           m.external_ids->>'api_sports' AS api_sports_id
    FROM matches m
    WHERE (
      m.status = 'scheduled'
      AND m.kickoff_at > now()
      AND m.kickoff_at < now() + interval '12 hours'
    ) OR (
      m.status IN ('scheduled', 'live')
      AND m.kickoff_at <= now()
      AND m.kickoff_at > now() - interval '30 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM match_lineups ml
        WHERE ml.match_id = m.id AND ml.is_current = true
      )
    )
    ORDER BY m.kickoff_at
  `;

  const now = new Date();
  const minutesNow = now.getUTCMinutes();

  const polled = [];
  let fetched = 0;
  let writtenTotal = 0;
  let skippedFar = 0;
  let skippedNoData = 0;
  let errors = 0;
  const errorDetails = [];

  for (const m of candidates) {
    const apiId = Number(m.api_sports_id);
    if (!Number.isInteger(apiId) || apiId <= 0) {
      errors++;
      errorDetails.push({ id: m.id, error: 'invalid api_sports id' });
      continue;
    }
    const minutesToKickoff = Math.round(
      (new Date(m.kickoff_at).getTime() - now.getTime()) / 60000,
    );
    const escalated = minutesToKickoff <= 60;
    const shouldPoll = escalated || minutesNow === 0;

    if (!shouldPoll) {
      skippedFar++;
      polled.push({ id: m.id, mins_to_kickoff: minutesToKickoff, action: 'skip-far' });
      continue;
    }

    if (dryRun) {
      polled.push({
        id: m.id, mins_to_kickoff: minutesToKickoff,
        action: 'would-fetch', escalated,
      });
      continue;
    }

    try {
      const r = await syncMatchLineups(m.id, apiId);
      fetched++;
      writtenTotal += r.written;
      if (!r.hadData) skippedNoData++;
      polled.push({
        id: m.id, mins_to_kickoff: minutesToKickoff,
        action: r.hadData ? 'wrote' : 'no-data',
        written: r.written, escalated,
      });
    } catch (err) {
      errors++;
      errorDetails.push({ id: m.id, error: String(err?.message ?? err) });
    }
  }

  return Response.json({
    candidates: candidates.length,
    fetched,
    written: writtenTotal,
    skipped_far: skippedFar,
    skipped_no_data: skippedNoData,
    errors,
    polled,
    ...(errors > 0 ? { error_details: errorDetails } : {}),
    ...(dryRun ? { dry_run: true } : {}),
  });
}
