/**
 * /api/cron/generate-gloss — AI Live Key Moments gloss pass.
 *
 * Status: WIRED BUT NOT ARMED. This route exists, accepts authenticated
 * GET, and runs the full pass when called manually. There is NO entry
 * in vercel.json yet — the route does nothing on a deploy clock. The
 * one-line change to arm it (after Saturday's go/no-go) is to add to
 * vercel.json's crons array:
 *
 *   { "path": "/api/cron/generate-gloss", "schedule": "*\/2 * * * *" }
 *
 * (Every 2 minutes mirrors the brief sweep cadence and stays well below
 * the per-minute poll-live tempo. Adjust if real-time gloss latency is
 * the goal; the structured row write is already instant — this pass
 * just decorates after.)
 *
 * Auth: Bearer ${CRON_SECRET}, same shape as the other crons.
 *
 * Manual invocation for dev:
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/generate-gloss
 *
 * Behavior: selects candidate matches (live OR finished within 6h with at
 * least one un-glossed qualifying event), then for each match runs
 * runGlossPassForMatch from lib/glossPass.js. Per-event try/catch is
 * inside the helper; a single bad event cannot abort the rest. A bad
 * match throws here and is logged as an error result but doesn't abort
 * other matches.
 *
 * Idempotent: only NULL-gloss rows are touched. Re-runs are a no-op for
 * already-processed events.
 *
 * Critical path: the live poll-live cron is on its own clock and its own
 * code path (lib/events.js → syncMatchEvents). This route NEVER touches
 * the structured-event write path. A failure here cannot affect the row.
 */

import { findCandidateMatches, runGlossPassForMatch } from '@/lib/glossPass';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PER_SWEEP_MATCH_CAP = 5;

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  const candidates = await findCandidateMatches({ limit: PER_SWEEP_MATCH_CAP });

  const matchResults = [];
  let totalKept = 0;
  let totalDropped = 0;
  let totalErrors = 0;

  for (const m of candidates) {
    try {
      const r = await runGlossPassForMatch(m.id);
      const kept = r.results.filter((x) => x.outcome === 'kept').length;
      const dropped = r.results.filter((x) => x.outcome === 'dropped').length;
      const errored = r.results.filter((x) => x.outcome === 'error').length;
      totalKept += kept;
      totalDropped += dropped;
      totalErrors += errored;
      matchResults.push({
        match_id: m.id,
        slug: m.slug,
        candidates: r.candidates,
        kept,
        dropped,
        errored,
        results: r.results,
      });
    } catch (err) {
      console.error(`generate-gloss: match ${m.id} (${m.slug}) failed —`, err);
      matchResults.push({
        match_id: m.id,
        slug: m.slug,
        outcome: 'error',
        error: String(err?.message ?? err),
      });
    }
  }

  return Response.json({
    candidate_matches: candidates.length,
    total_kept: totalKept,
    total_dropped: totalDropped,
    total_errors: totalErrors,
    matches: matchResults,
  });
}
