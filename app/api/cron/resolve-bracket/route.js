/**
 * /api/cron/resolve-bracket -- Vercel cron target.
 * Schedule: every 15 minutes (see vercel.json).
 *
 * Calls resolveKnockoutBracket('fifa-wc-2026', { dryRun: false }) on
 * the WC knockout slots. The resolver fills knockout slots that have
 * become mathematically determinate since the last tick:
 *   - group_winner    <- a team marginindependently locked at 1st place
 *   - group_runner_up <- marginindependently locked at 2nd place
 *   - best_third      <- group stage complete + routing table lookup
 *   - winner_of / loser_of <- decided parent KO match
 *
 * Safety by construction. No live-match hold here is required, because
 * computePositionClinch treats every non-final group fixture as a
 * REMAINING fixture and enumerates all 3 outcomes (H/D/A). A position
 * only clinches when it survives every remaining-outcome scenario, so
 * a live or in-progress match cannot cause a false clinch -- worst
 * case the live match is one of the remaining fixtures whose outcomes
 * are already enumerated. The IS-NULL guard on the UPDATE statement
 * makes the resolver idempotent: already-filled slots are never
 * touched. Running the cron against a live tournament is safe.
 *
 * KO winner_of / loser_of: penalty-shootout results are currently NOT
 * decodable from our matches rows (syncFixture maps FT/AET/PEN all to
 * status='final' and writes home_score/away_score = end-of-regulation
 * goals, omitting the shootout result). The resolver surfaces any
 * winner_of/loser_of slot whose parent ended in a regulation draw as
 * skipped[]. Penalty data capture is a tracked follow-up before R32
 * (Jun 28); until then, KO progression past a penalty-decided match
 * will be a no-op for that branch.
 *
 * Auth: Bearer ${CRON_SECRET}. Same secret as the other crons.
 *
 * Debugging:
 *   ?dry=1   read-only run; returns the same shape but writes=0.
 *            CRON_SECRET still required.
 *
 * Response shape:
 *   { ok: true,
 *     writes: number,
 *     plan:    [{ match_number, side, team_id, team_name, source }],
 *     skipped: [{ match_number, side, reason }],
 *     position_clinch: { [groupLetter]: { [teamId]: 'clinched_1st'|'clinched_2nd' } },
 *     live_at_run: [{ match_id, status, kickoff_at }],  // observability only
 *     timing_ms,
 *     dryRun
 *   }
 */

import { sql } from '@/lib/db';
import { resolveKnockoutBracket } from '@/lib/bracket';

export const dynamic = 'force-dynamic';
// 60s is generous. Real-write of the manual 3-fill case was ~1s; the
// steady-state cron should be a sub-second no-op since the IS-NULL
// guard skips already-filled slots.
export const maxDuration = 60;

const WC_LEAGUE_SLUG = 'fifa-wc-2026';

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
  const t0 = Date.now();

  try {
    // Observability only: report any live WC match at run time, so cron
    // logs make it obvious when the resolver ticked during live play
    // (and that the safety-by-construction reasoning held).
    const liveRows = await sql`
      SELECT m.id AS match_id, m.status, m.kickoff_at
        FROM matches m
        JOIN leagues lg ON lg.id = m.league_id
       WHERE lg.slug = ${WC_LEAGUE_SLUG}
         AND m.status = 'live'
    `;

    const { plan, skipped, positionClinch, writes } = await resolveKnockoutBracket(
      WC_LEAGUE_SLUG,
      { dryRun }
    );

    // Map<group, Map<teamId, status>> isn't JSON-friendly; flatten to a
    // plain object so cron logs stay greppable.
    const position_clinch_flat = {};
    for (const [letter, byTeam] of positionClinch) {
      const obj = {};
      for (const [teamId, status] of byTeam) {
        if (status) obj[String(teamId)] = status;
      }
      if (Object.keys(obj).length > 0) position_clinch_flat[letter] = obj;
    }

    const result = {
      ok: true,
      writes,
      plan,
      skipped,
      position_clinch: position_clinch_flat,
      live_at_run: liveRows,
      timing_ms: Date.now() - t0,
      dryRun,
    };
    console.log('[resolve-bracket]', JSON.stringify({
      writes,
      plan_count: plan.length,
      skipped_count: skipped.length,
      live_count: liveRows.length,
      timing_ms: result.timing_ms,
      dryRun,
    }));
    return Response.json(result);
  } catch (err) {
    console.error('[resolve-bracket] error', err);
    return Response.json({
      ok: false,
      message: String(err?.message ?? err),
      stack:   err?.stack ?? null,
    }, { status: 500 });
  }
}
