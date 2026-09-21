/**
 * /api/cron/power-edition?league=cfb|nfl - publish one computed gridiron
 * power-ranking edition.
 *
 * SCHEDULE (vercel.json, UTC as every cron in that file is):
 *     0 15 * * 1   ?league=cfb   Mondays 15:00Z
 *     5 13 * * 2   ?league=nfl   Tuesdays 13:05Z
 *
 * UTC IS NOT PT, AND THE GAP MOVES. vercel.json has no daylight-saving logic
 * anywhere in it, so a fixed UTC hour drifts one hour against Pacific time
 * twice a year - exactly the drift app/api/cron/cfb-rankings/route.js lives
 * with when it calls 14:15Z "10:15 AM ET". These two are sized for PDT, the
 * half of the year the season is played in:
 *     15:00Z = 8:00 AM PDT (Mar-Nov)  ->  7:00 AM PST (Nov-Mar)
 *     13:05Z = 6:05 AM PDT (Mar-Nov)  ->  5:05 AM PST (Nov-Mar)
 * Both run EARLIER in Pacific terms once the clocks go back, never later,
 * which is the safe direction: a board published earlier is still published
 * before anybody reads it.
 *
 * ORDERING IS WHY CFB IS 15:00Z AND NOT 13:00Z. cfb-rankings imports the AP
 * poll at 14:15Z on Mondays and Tuesdays. A CFB edition MUST read the newest
 * poll, so it fires 45 minutes AFTER that import rather than before it -
 * the same discipline cfb-rankings itself documents about pickem-board, which
 * it deliberately follows rather than races. 13:00Z was also unavailable on
 * its own terms: gridiron-props already holds it.
 *
 * THE NFL IS TUESDAY BECAUSE MONDAY NIGHT IS A GAME. A Monday edition would
 * publish a board that did not include the Monday night result and would then
 * be wrong for six days. 13:05Z on Tuesday is after every Monday-night final
 * has settled and five minutes clear of nothing in particular - it is offset
 * from the 13:00Z block (gridiron-props) so two jobs do not contend for the
 * same minute.
 *
 * ONE ROUTE, TWO LEAGUES, BY QUERY PARAMETER. The work is identical and the
 * only difference is a LEAGUE_CONFIG entry; two routes would be two copies of
 * this file differing in one string.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { publish, LEAGUE_CONFIG } from '@/lib/rankings/publishGridironEdition';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SOURCE = 'power-edition';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const league = new URL(request.url).searchParams.get('league');
  // AN UNKNOWN LEAGUE IS A 400, NOT A DEFAULT. Defaulting to one of them would
  // mean a typo'd cron entry silently republished the wrong board every week.
  if (!Object.hasOwn(LEAGUE_CONFIG, String(league))) {
    await recordDecision(sql, { source: SOURCE, kind: 'bad-league', summary: { league } });
    return Response.json({ error: 'league must be one of ' + Object.keys(LEAGUE_CONFIG).join(', ') }, { status: 400 });
  }

  // THE LOCK IS PER LEAGUE. The two leagues share a route and a source but not
  // a board, and a CFB run must not be skipped because an NFL run is mid-write.
  const outcome = await withAdvisoryLock(`${SOURCE}:${league}`, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'weekly',
    run: async () => {
      const { summary } = await publish({ league, apply: true });
      return { ok: true, summary };
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: { league } });
    return Response.json({ league, decision: 'skipped-locked' });
  }

  const res = outcome.result;
  // A FAILED PUBLISH IS AN ALARM. The board is a weekly artifact: if this
  // fails on a Monday nobody sees a stale board until the following Monday,
  // and a stale board looks exactly like a fresh one.
  if (!res.ok) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[pollers] ${SOURCE} FAILED for ${league}`,
      body: `source: ${SOURCE}\nleague: ${league}\n\n${res.error ?? JSON.stringify(res.summary, null, 1)}`,
    });
  }

  return Response.json({ league, ok: res.ok, id: res.id, summary: res.summary });
}
