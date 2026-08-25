/**
 * /api/cron/cfb-rankings - the weekly AP + Coaches Poll import.
 *
 * SCHEDULE: 15 14 * * 1,2  -> 14:15Z Mondays and Tuesdays (10:15 AM ET).
 *
 * WHY TWICE, AND WHY NOT SUNDAY. The AP poll is released Sunday afternoon ET in
 * most weeks but MONDAY in others - the preseason poll and several in-season
 * weeks land Monday - and CFBD publishes some time after AP does. A Sunday-only
 * cron would miss every Monday release for a full week, which is exactly the
 * week the board is built from. Monday AND Tuesday costs one extra request and
 * removes the guesswork: whichever day it lands, we hold it before Tuesday's
 * 13:23Z pickem-board run needs it.
 *
 * ORDERING MATTERS. This fires at 14:15Z; pickem-board fires at 13:23Z. So on
 * any given Tuesday the board is built from the poll imported the PREVIOUS day.
 * That is deliberate - a board must never depend on a poll that arrives 52
 * minutes after it. Monday's run is the one that feeds Tuesday's board;
 * Tuesday's run is the safety net for a late Monday publish, and it lands in
 * time for the FOLLOWING week.
 *
 * Cost: one CFBD request per fire (both polls ride one response), so ~8/month
 * against a 30,000 cap.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { importRankingsWeek, currentCfbSeason } from '@/lib/cfb/rankingsImport';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision, probeCfbdBudget } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SOURCE = 'cfb-rankings';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const season = await currentCfbSeason();

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'weekly',
    budget: probeCfbdBudget,
    // No week argument: CFBD returns only the weeks it has published, so this
    // picks up whatever is newest without us predicting the calendar.
    run: () => importRankingsWeek({ season }),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: { season } });
    return Response.json({ season, decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const unresolved = Object.keys(res.summary?.unresolved ?? {}).length;
  // Its own alarm source, per the standing pattern - maybeAlert rate-limits per
  // source, so sharing one with another poller would let an unrelated failure
  // silence this for six hours. A ranked team we cannot resolve matters: the
  // inclusion rule joins on team_id, so an unresolved team is an UNRANKED team
  // as far as the board is concerned.
  if (!res.ok || unresolved > 0) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[pollers] ${SOURCE} ${!res.ok ? 'FAILED' : `${unresolved} unresolved ranked team(s)`}`,
      body: `source: ${SOURCE}\nseason: ${season}\n\n${res.error ?? JSON.stringify(res.summary, null, 1)}`,
      detail: Object.entries(res.summary?.unresolved ?? {}).map(([k, v]) => ({ poll: k, teams: v })),
    });
  }

  return Response.json({ season, ok: res.ok, id: res.id, summary: res.summary });
}
