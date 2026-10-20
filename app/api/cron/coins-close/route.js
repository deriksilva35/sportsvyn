/**
 * /api/cron/coins-close - THE TUESDAY DRAWING (Rules v0.1 s2, s5; coins-2 B5).
 *
 * 0 16 * * 2 and 0 17 * * 2 UTC (?slot=pdt / ?slot=pst): 09:00 PT in either
 * half of the year. Vercel's clock is UTC, so the route does not trust it: a
 * week closes only once its own closes_at (09:00 PT, lib/coins/week.js) has
 * passed, and drawn_at is claimed once - the other firing finds nothing.
 * Off unless COINS=on. Shares the 'coins' lock with the hourly mint.
 * lib/coins/close.js runClose: mint, auto-drop, seed, draw, winners, next
 * week, push + email to every entrant.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { coinsEnabled } from '@/lib/coins/mint';
import { runClose } from '@/lib/coins/close';
import { makeResultsSender } from '@/lib/coins/resultsEmail';
import { notifyPersonalized } from '@/lib/push/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SOURCE = 'coins-close';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  if (!coinsEnabled()) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-off', summary: {} });
    return Response.json({ decision: 'skipped-off' });
  }
  const outcome = await withAdvisoryLock('coins', async () => recordRun(sql, {
    source: SOURCE, kind: 'run',
    run: async () => runClose({ send: makeResultsSender(), notify: notifyPersonalized }),
  }));
  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  const s = res.summary ?? {};
  if (!res.ok) await maybeAlert(sql, { source: SOURCE, subject: '[coins-close] the drawing failed', body: String(res.error ?? '') });
  else if (s.decision === 'drawn') await maybeAlert(sql, { source: SOURCE, subject: `[coins-close] week ${s.ordinal} drawn`, body: JSON.stringify(s, null, 2) });
  return Response.json({ ok: res.ok, ...s });
}
