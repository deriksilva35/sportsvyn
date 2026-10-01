/**
 * /api/cron/odds-budget - The Odds API monthly plan, watched (thu-12, item 4).
 *
 * DAILY, 5 9 * * * UTC: five minutes after the 09:00Z futures tick
 * (ODDS_FUTURES_HOUR, lib/pollers/cadence.js) and clear of every other cron's
 * minute. One free /v4/sports call reads used + remaining; this month's
 * sync_runs say which sport spent it. When the month crosses 50, 70 or 90% of
 * plan the admin's phone gets ONE push for the highest threshold crossed:
 *   "Odds API 72% of plan (72,123 / 100,000) · NFL 41% · CFB 30% · EPL 29%"
 * Each threshold pushes once per month (event id ops-odds-budget:YYYY-MM:T).
 *
 * The work is lib/gridiron/oddsBudgetRun.js; the decisions are pure, in
 * lib/gridiron/oddsBudget.js. A run that cannot read usage at all fails, and
 * a failed run emails through maybeAlert like every other poller.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { fetchUsage } from '@/lib/theOddsApi';
import { runOddsBudget } from '@/lib/gridiron/oddsBudgetRun';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SOURCE = 'odds-budget';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'daily',
    run: () => runOddsBudget({ sql, fetchUsage }),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[pollers] ${SOURCE} FAILED`,
      body: `source: ${SOURCE}\n\n${res.error}`,
    });
  }
  return Response.json({ ok: res.ok, id: res.id, ...(res.summary ?? {}) });
}
