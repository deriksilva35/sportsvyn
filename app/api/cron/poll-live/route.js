/**
 * /api/cron/poll-live — Vercel cron target. Schedule: every minute.
 *
 * Auth: Bearer ${CRON_SECRET} per Vercel docs. Vercel attaches this
 * header automatically when the cron fires; manual hits without the
 * header return 401 so the endpoint can't be turned into a public
 * API-Sports proxy.
 *
 * Behaviour:
 *   - Query getMatchesToPoll() (lib/liveMatches.js). Predicate covers
 *     live matches plus scheduled matches inside a [now-4h, now+15m]
 *     window so the very first poll fires before kickoff.
 *   - When the list is empty (the common case — no live match), return
 *     {polled:0} without calling API-Sports. Zero budget, zero
 *     sync_log rows.
 *   - For each match, call syncFixture(apiSportsId) wrapped in its own
 *     try/catch so one failing fixture doesn't abort the others. The
 *     sync_log row for a failed call is written by syncFixture's own
 *     catch arm, not here.
 *
 * Response: { polled: N, matches: [{ id, slug, status, score, minute, error? }] }
 */

import { getMatchesToPoll } from '@/lib/liveMatches';
import { syncFixture } from '@/lib/syncFixture';
import { captureLiveWatchScoreTick } from '@/lib/captureLiveWatchScore';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  if (
    !process.env.CRON_SECRET ||
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  const matches = await getMatchesToPoll();

  if (matches.length === 0) {
    return Response.json({ polled: 0, matches: [] });
  }

  const results = [];
  for (const m of matches) {
    const apiId = Number(m.api_sports_id);
    if (!Number.isInteger(apiId) || apiId <= 0) {
      results.push({ id: m.id, slug: m.slug, error: 'invalid api_sports id' });
      continue;
    }
    try {
      const r = await syncFixture(apiId);
      // Piggyback: capture a Live Watch Score history row from the just-written
      // is_current event state. Own try/catch — a capture failure (DB blip,
      // formula throw) can't abort the surrounding poll-live loop or block
      // other matches. The sync_log row from syncFixture is independent.
      try {
        await captureLiveWatchScoreTick(r.match_id, r);
      } catch (capErr) {
        console.error(
          `captureLiveWatchScoreTick failed for match ${r.match_id} (${r.slug}):`,
          capErr,
        );
      }
      results.push({
        id: r.match_id,
        slug: r.slug,
        status: r.status,
        score: { home: r.home_score, away: r.away_score },
        minute: r.minute,
      });
    } catch (err) {
      // syncFixture already wrote its own error row to sync_log.
      results.push({
        id: m.id,
        slug: m.slug,
        error: String(err?.message ?? err),
      });
    }
  }

  return Response.json({ polled: results.length, matches: results });
}
