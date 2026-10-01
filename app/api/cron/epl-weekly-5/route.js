/**
 * /api/cron/epl-weekly-5 - EPL Weekly 5's three chores, one run:
 *
 *   1. OPEN the next gameweek (lib/eplWeekly5/create.js) - the lowest round
 *      with a fixture still to play; idempotent, so most runs create nothing.
 *   2. FLAGS: the feed's injured/suspended list for the open gameweek's
 *      fixtures still ahead (lib/eplWeekly5/availability.js) - ONE API-Sports
 *      request per run, none when nothing is ahead. 8 runs a day = at most 8
 *      requests a day.
 *   3. GRADE every gameweek whose fixtures are all final and re-checked
 *      (lib/eplWeekly5/settle.js). Most runs find nothing ready.
 *
 * 40 *\/3 * * * UTC. Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { ensureNextGameweek } from '@/lib/eplWeekly5/create';
import { refreshAvailability } from '@/lib/eplWeekly5/availability';
import { settleDueGameweeks } from '@/lib/eplWeekly5/settle';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'epl-weekly-5';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'settle',
    run: async () => {
      const now = new Date();
      const opened = await ensureNextGameweek({ now });
      const flags = await refreshAvailability(sql, { now }).catch((e) => ({ error: String(e?.message ?? e).slice(0, 200) }));
      const graded = await settleDueGameweeks({ now });
      return { opened, flags, graded };
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  const summary = res.summary ?? {};
  const errored = (summary.graded?.results ?? []).filter((r) => r.error);
  if (!res.ok || errored.length || summary.flags?.error) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[epl-weekly-5] run FAILED',
      body: [res.error ?? '', summary.flags?.error ?? '', ...errored.map((e) => `contest ${e.contestId}: ${e.error}`)].filter(Boolean).join('\n'),
    });
  }
  return Response.json({ ok: res.ok, ...summary });
}
