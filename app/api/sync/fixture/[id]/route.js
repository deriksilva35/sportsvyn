/**
 * /api/sync/fixture/[id] — single-fixture sync endpoint.
 *
 * The match page's <LiveHero> hits this every 60s during live status to
 * pull fresh state from API-Sports + persist it via lib/syncFixture.js.
 *
 * Scope check: only fixtures we've explicitly imported into the matches
 * table are in coverage. Anything else returns 403 so the route can't be
 * turned into an open proxy against API-Sports. The matches table is the
 * source of truth for which fixtures Sportsvyn covers (same pattern as
 * /api/match/[slug]/status), replacing the previous hardcoded whitelist
 * which had to be manually updated for each new fixture.
 *
 * Cost note (architectural follow-up): a successful call triggers 3
 * paid API-Sports calls (fixture + events + statistics in parallel)
 * inside syncFixture(). At many-viewers scale this multiplies API
 * calls per tab per 60s on top of the cron's own per-minute sync. The
 * right shape is for LiveHero to read DB-only state and let the cron
 * own API-Sports calls — separate slice.
 *
 * Returns { status, status_short, home_score, away_score, minute }.
 */

import { syncFixture } from '@/lib/syncFixture';
import { sql } from '@/lib/db';

export async function GET(_request, { params }) {
  const { id } = await params;
  const fixtureId = Number(id);

  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return Response.json({ error: 'Invalid fixture id' }, { status: 400 });
  }

  const rows = await sql`
    SELECT 1 FROM matches WHERE external_ids->>'api_sports' = ${String(fixtureId)} LIMIT 1
  `;
  if (!rows[0]) {
    return Response.json({ error: 'Fixture not in coverage' }, { status: 403 });
  }

  try {
    const result = await syncFixture(fixtureId);
    return Response.json({
      status: result.status,
      status_short: result.status_short,
      home_score: result.home_score,
      away_score: result.away_score,
      minute: result.minute,
    });
  } catch (err) {
    console.error('syncFixture failed:', err);
    return Response.json({ error: 'Sync failed' }, { status: 500 });
  }
}
