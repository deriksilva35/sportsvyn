/**
 * /api/cron/epl-fixtures — keep the Premier League season in sync.
 *
 * DAILY, WHOLE-SEASON. Two provider requests (teams + fixtures) refresh every
 * kickoff time, score and status for the season - so a rescheduled fixture, a
 * corrected score and a completed matchweek all self-heal without a per-match
 * poll. Idempotent by slug; a re-run changes nothing that has not moved.
 *
 * 25 13 * * * UTC = 9:25 AM ET in EDT (8:25 EST) - one minute past
 * weekly-board's 13:24 and two past pickem-board's 13:23. The stagger is
 * deliberate: three creators, three distinct minutes, three legible ledgers.
 *
 * THE SOCCER METER IS NOT THE GRIDIRON METER. api-football (v3.football) is a
 * separate Ultra subscription at 75,000 requests/day; the 2,000/day cap that
 * governs the american-football poller cannot be touched from here.
 *
 * THE CHAMPIONS LEAGUE RIDES ALONG (ucl, fri-3): two more requests (its
 * teams + its fixtures) after the EPL's, in the same run. Its failure is its
 * own - recorded under `ucl` in the summary and alerted - and never costs the
 * Premier League its sync.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { syncEpl, syncUcl, apiSportsPlan } from '@/lib/soccer/epl';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'epl-fixtures';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'sync',
    // THE PLAN RIDES IN THE SUMMARY (thu-24): the first PROD run after the
    // upgrade must say which plan answered - and so must a failed one.
    run: async () => {
      const apiSportsAccount = await apiSportsPlan();
      // The UCL first, caught to its summary: an EPL failure below still
      // throws (and names the plan) exactly as it did.
      const ucl = await syncUcl().catch((e) => ({ error: String(e?.message ?? e).slice(0, 300) }));
      try {
        return { ...(await syncEpl()), ucl, apiSports: apiSportsAccount };
      } catch (e) {
        throw new Error(`${e?.message ?? e} [api-sports plan: ${apiSportsAccount.plan ?? apiSportsAccount.error}]`);
      }
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const summary = res.summary ?? {};
  const ucl = summary.ucl ?? {};
  if (res.ok && (ucl.error || (ucl.skipped ?? 0) > 0)) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[ucl] fixture sync ${ucl.error ? 'FAILED' : 'incomplete'}`,
      body: [ucl.error ?? '', ...(ucl.skippedReasons ?? [])].filter(Boolean).join('\n'),
    });
  }
  if (!res.ok || (summary.skipped ?? 0) > 0) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[epl] fixture sync ${res.ok ? 'incomplete' : 'FAILED'}`,
      body: [res.error ?? '', ...(summary.skippedReasons ?? [])].filter(Boolean).join('\n'),
    });
  }
  return Response.json({ ok: res.ok, ...summary });
}
