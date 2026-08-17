/**
 * /api/cron/draft-settle — settle every due DRAFT contest.
 *
 * HOURLY ACROSS TUESDAY, NOT ONCE. The ruling set the Weekly at 05:00 ET and
 * The Draft an hour later, and the stagger is honoured - but a SINGLE firing
 * that refuses would push the reveal a full WEEK, because this is a weekly
 * cron. That is the opposite of "if the feed is slow, a noon reveal is
 * on-spec". (The vendor is named in lib/weekly/settle.js, which is not
 * user-facing source; a house guard forbids it under app/ and components/.)
 * So each game runs hourly through Tuesday from its own start hour, and the
 * completeness gate decides which firing actually settles.
 *
 * THE STAGGER IS REAL: separate routes, separate advisory locks, separate
 * recordRun rows, no shared state mid-job. A Draft failure cannot leave the
 * Weekly half-settled, and settleDue is scoped by game_type so neither run can
 * see the other's contests.
 *
 * UTC, AND THE DST CAVEAT IS DELIBERATE. Vercel cron expressions are UTC.
 * 09:00Z is 05:00 ET in EDT and 04:00 ET in EST; the window runs long enough
 * either way that the shift costs nothing, and the gate - not the clock -
 * decides. Pinning to a local hour is what fired a backstop four hours early
 * on 13 Aug.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { settleDue } from '@/lib/weekly/settle';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'draft-settle';
const GAME_TYPE = 'draft';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'settle',
    run: async () => settleDue(GAME_TYPE),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const summary = res.summary ?? {};

  // A REFUSAL IS NOT A FAILURE and must not page anybody. "Stats are not in
  // yet" is the expected state for most firings; only a thrown error is worth
  // waking someone for.
  const errored = (summary.results ?? []).filter((r) => r.error);
  if (!res.ok || errored.length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[draft] settle FAILED`,
      body: `${res.error ?? ''}\n${errored.map((e) => `contest ${e.contestId}: ${e.error}`).join('\n')}`,
    });
  }
  return Response.json({ ok: res.ok, ...summary });
}
