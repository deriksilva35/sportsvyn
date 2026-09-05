/**
 * /api/cron/pickem-board — create the next Pick'em board(s) when their open
 * arrives.
 *
 * TWO SPORTS, ONE RUN, CFB THEN NFL (relay 2c item 5) - each sport is its own
 * independent contest row, own existence check, own open gate, and its own
 * recordRun so a failure in one never hides in the other's summary. Order is
 * fixed (cfb, then nfl) so the response shape and the sync_runs log read the
 * same way every day.
 *
 * DAILY, AND ALMOST ALWAYS A NO-OP, by design. Each sport's builder gates on
 * its OWN board's opens_at (Tuesday morning ET before its slate's first
 * kickoff) and is idempotent against 067's unique index, so every fire is
 * safe: before the open it reports before-open, after creation it reports
 * exists, and the one fire in between creates. A daily cadence means a
 * failed Tuesday gets retried Wednesday instead of costing the week.
 *
 * MONDAY CANNOT PASS SILENTLY: every fire lands a recordRun row per sport in
 * sync_runs whose summary names the outcome (created / exists / before-open /
 * no-upcoming-games), and a run that throws alerts through maybeAlert - the
 * daily-puzzle pattern, inherited whole.
 *
 * 13:23 UTC = 9:23 AM ET in EDT (8:23 in EST): deliberately after the
 * 9:00 AM ET open gate, so the board is created the same morning it opens.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { ensurePickemBoard } from '@/lib/pickem/create';
import { pushEnabled } from '@/lib/push/apns';
import { notifyPickemOpen } from '@/lib/push/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const SOURCE = 'pickem-board';
export const SPORTS = ['cfb', 'nfl'];

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => {
    const bySport = {};
    for (const sport of SPORTS) {
      bySport[sport] = await recordRun(sql, {
        source: SOURCE,
        kind: 'create',
        run: async () => ensurePickemBoard({ leagueSlug: sport }),
      });
    }
    return bySport;
  });

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const body = {};
  for (const sport of SPORTS) {
    const res = outcome.result[sport];
    if (!res.ok) {
      await maybeAlert(sql, {
        source: SOURCE,
        subject: `[pickem] ${sport} board creation FAILED`,
        body: String(res.error ?? 'unknown error'),
      });
    }
    // PUSH HOOK: the one fire that CREATES announces the board, PER SPORT -
    // send-once inside notifyEvent (keyed by this board's own contest id)
    // makes this safe even if a later fire somehow reported created again;
    // caught so a push hiccup cannot fail the creation run.
    if (res.ok && res.summary?.created && pushEnabled()) {
      await notifyPickemOpen(res.summary).catch(() => {});
    }
    body[sport] = { ok: res.ok, ...res.summary };
  }
  return Response.json(body);
}
