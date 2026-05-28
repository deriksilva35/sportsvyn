/**
 * /api/sync/fixture/[id] — single-fixture sync endpoint.
 *
 * The match page's <LivePoller> hits this every 60s during live status to
 * pull fresh state from API-Sports + persist it via lib/syncFixture.js.
 *
 * Whitelisted: only fixture ids in ALLOWED_FIXTURE_IDS can be synced via
 * this endpoint. Anything else returns 403 so the route can't be turned
 * into an open proxy against API-Sports.
 *
 * Returns { status, home_score, away_score, minute }.
 */

import { syncFixture } from '@/lib/syncFixture';

const ALLOWED_FIXTURE_IDS = new Set([1503008]);

export async function GET(_request, { params }) {
  const { id } = await params;
  const fixtureId = Number(id);

  if (!Number.isInteger(fixtureId) || !ALLOWED_FIXTURE_IDS.has(fixtureId)) {
    return Response.json({ error: 'Fixture id not allowed' }, { status: 403 });
  }

  try {
    const result = await syncFixture(fixtureId);
    return Response.json({
      status: result.status,
      home_score: result.home_score,
      away_score: result.away_score,
      minute: result.minute,
    });
  } catch (err) {
    console.error('syncFixture failed:', err);
    return Response.json({ error: 'Sync failed' }, { status: 500 });
  }
}
