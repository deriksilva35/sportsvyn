/**
 * /api/cron/gridiron-props — player props poller (The Odds API, per-event).
 *
 * ITS OWN CRON, ITS OWN CADENCE, and deliberately NOT the every-15-minutes
 * rhythm of the sport-level poller. Props are billed
 * per game, so that cadence would cost
 * 108 credits every tick — around 10,000 a day for numbers that do not move
 * anything like that fast. Four ticks a day: two flat reads, and the tight
 * window before kickoff where prop lines actually do move.
 *
 * SCOPE IS ENFORCED BY THE INGEST'S JOIN, not here. See propsScope: a game
 * reaches the call list only via its league's current game week (nfl, epl) or
 * the Pick'em board (cfb). Nothing in this file can widen it.
 *
 * PROJECTED SPEND, at the launch scope and today's counts:
 *   nfl 16 games x 4 markets = 64
 *   cfb  8 board games x 3   = 24
 *   epl 10 matches x 2       = 20
 *   ----------------------------------
 *   108 credits/tick x 4 ticks = 432 credits/day, ~13K/month.
 * Against the 100K plan, alongside the sport-level poller's ~7.5K/month.
 *
 * THE KEY GUARD IS THE POINT OF THE LEDGER. A props ingest pointed at the
 * wrong API key drains it silently — every call returns 200 until the moment
 * one does not. The vendor's own requests_remaining rides into sync_runs on
 * every run, and keyAlert fires on a plan that is too small to be the 100K one
 * or on a remaining balance under the floor. It watches the HEADER, not the
 * config, because the failure being guarded against is a key that is not the
 * one the config claims.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { ingestSportProps, keyAlert, zeroMatchAlert } from '@/lib/gridiron/propsIngest';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const LEAGUES = [
  { sport: 'nfl', slug: 'nfl', source: 'nfl-props' },
  { sport: 'cfb', slug: 'cfb', source: 'cfb-props' },
  { sport: 'epl', slug: 'epl', source: 'epl-props' },
];

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const out = [];
  for (const lg of LEAGUES) {
    const outcome = await withAdvisoryLock(lg.source, async () => {
      const res = await recordRun(sql, {
        source: lg.source,
        kind: 'props',
        run: () => ingestSportProps(sql, { sport: lg.sport, leagueSlug: lg.slug }),
      });
      if (!res.ok) {
        await maybeAlert(sql, {
          source: lg.source,
          subject: `[pollers] ${lg.source} FAILED`,
          body: `source: ${lg.source}\n\n${res.error}`,
        });
        return res;
      }
      // ZERO-MATCH GUARD. Props scope games locally, so "scoped" is the
      // event count that matters: games we intended to price.
      const zero = zeroMatchAlert({
        events: res.summary?.scoped ?? 0,
        matched: res.summary?.called ?? 0,
        source: lg.source,
      });
      if (zero) {
        // ITS OWN SOURCE KEY, AND THAT IS NOT COSMETIC. maybeAlert rate-limits
        // BY SOURCE: a different payload inside the window returns
        // rate_limited and writes NO ledger row at all. Sharing the league's
        // source meant a CREDIT/KEY WARNING 40 minutes earlier silently
        // swallowed this alert - observed in production on 28 Aug, nfl-props
        // scoped 13 / called 0 with no row emitted. A distinct source gives
        // the condition its own window.
        await maybeAlert(sql, {
          source: `${lg.source}-zeromatch`,
          subject: `[pollers] ${lg.source} MATCHED NOTHING`,
          body: zero,
        });
      }
      // THE KEY / BUDGET GUARD, on every successful run.
      const warn = keyAlert(res.summary?.budget);
      if (warn) {
        await maybeAlert(sql, {
          source: lg.source,
          subject: `[pollers] ${lg.source} CREDIT/KEY WARNING`,
          body: `source: ${lg.source}\n\n${warn}\n\nbudget: ${JSON.stringify(res.summary?.budget)}`,
        });
      }
      // A market the vendor started pricing that we do not map is surfaced,
      // never silently dropped.
      if (res.summary?.unmappedMarkets?.length) {
        await maybeAlert(sql, {
          source: lg.source,
          subject: `[pollers] ${lg.source} unmapped prop markets`,
          body: `new vendor market keys: ${res.summary.unmappedMarkets.join(', ')}`,
        });
      }
      return res;
    });
    out.push(outcome.locked
      ? { source: lg.source, decision: 'skipped-locked' }
      : {
        source: lg.source,
        ok: outcome.result.ok,
        scoped: outcome.result.summary?.scoped,
        called: outcome.result.summary?.called,
        credits: outcome.result.summary?.creditsLast,
        upserted: outcome.result.summary?.upserted,
      });
  }
  return Response.json({ decision: 'props', leagues: out });
}
