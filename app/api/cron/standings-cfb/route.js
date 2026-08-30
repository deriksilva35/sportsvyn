/**
 * /api/cron/standings-cfb — CFB team records, all classifications.
 *
 * ONE CALL, HOURLY. CFBD /records?year= returns every D-I-and-below team in a
 * single response, so the cost is flat whether one game finished or ninety.
 * Hourly rather than daily because records are what a card renders the moment
 * a game ends, and a Saturday produces results for twelve hours.
 *
 * FBS AND FCS BOTH. This is the records half of the FCS tier-(a) ruling: the
 * provider carries an FCS team's COMPLETE record including the 651 FCS-vs-FCS
 * games a season we deliberately do not ingest, so this is the only way those
 * teams get an honest W-L.
 *
 * 20 * * * * UTC — a free minute, clear of cfb-rankings (:15), the creator
 * block (:23-:26) and the :00 crowd.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { syncCfbRecords } from '@/lib/standings/cfb';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const SOURCE = 'standings-cfb';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const season = resolveSeasonYear(new Date());
  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'sync',
    run: async () => {
      const [lg] = await sql`SELECT id FROM leagues WHERE slug = 'cfb' LIMIT 1`;
      if (!lg) return { season, reason: 'no-league-row' };
      return syncCfbRecords(lg.id, season);
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: { season } });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  // unmapped is fail-loud the way every other gridiron sync is: a provider
  // that adds a split block should be noticed, not silently ignored.
  const unmapped = res.summary?.unmapped ?? [];
  if (!res.ok || unmapped.length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[standings] cfb ${!res.ok ? 'FAILED' : `unmapped: ${unmapped.join(',')}`}`,
      body: `season: ${season}\n\n${res.error ?? JSON.stringify(res.summary)}`,
    });
  }
  return Response.json({ ok: res.ok, ...res.summary });
}
