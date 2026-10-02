/**
 * /api/cron/epl-live - the Premier League live poller (thu-24). Every minute.
 *
 * NOT poll-live. That route (retired tue-14, still unscheduled) polled any
 * league's live rows and ran a stuck-live sweep that finaled games on time
 * since kickoff. This one sees EPL rows only, finals a row only when the
 * provider says so (or the fixture leaves a good response and the row has
 * been quiet 30 minutes), and returns at once outside an EPL window - three
 * small reads, no provider call, no ledger row. See lib/soccer/eplLive.js.
 *
 * The window: a fixture from 15 minutes before kickoff to 150 after, any row
 * held live, a final whose full-time player stats are not in yet, or one
 * whose +24h re-sync is due. One API-Sports request a tick covers the lot
 * (/fixtures?ids=), and the daily-cap breaker is the shared one.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { apiSports } from '@/lib/apiSports';
import { runEplLive, eplWindowOpen, RESETTLE_HOOKS } from '@/lib/soccer/eplLive';
import { registerResettle } from '@/lib/eplWeekly5/settle';

// EPL Weekly 5 re-grades a settled gameweek when the +24h re-sync changes a stat.
registerResettle(RESETTLE_HOOKS);

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SOURCE = 'epl-live';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  // OUTSIDE A WINDOW NOTHING IS RECORDED: 1,440 noop rows a day would bury the
  // matchday ones. Three small reads decide it, before any ledger row exists.
  if (!(await eplWindowOpen(sql))) return Response.json({ decision: 'outside-window' });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'live',
    run: async () => {
      const r = await runEplLive({ sql, client: apiSports });
      if (r.errors?.length) throw new Error(`epl-live: ${r.errors.length} error(s): ${r.errors.slice(0, 3).join(' | ')}`);
      return r;
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, { source: SOURCE, subject: `[pollers] ${SOURCE} FAILED`, body: `source: ${SOURCE}\n\n${res.error}` });
  }
  return Response.json({ ok: res.ok, id: res.id, ...(res.summary ?? {}) });
}
