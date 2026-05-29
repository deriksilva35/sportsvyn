// lib/oddsMatches.js — selects matches the odds-refresh cron should
// check this hour.
//
// Predicate:
//   status = 'scheduled'
//   AND kickoff_at BETWEEN now() AND now() + interval '10 days'
//
// 10-day upper bound matches when sportsbook 1X2 lines typically start
// appearing in aggregator feeds for major fixtures. It's wide enough to
// cover the WC group stage rolling into the window day-by-day. Past-kick
// matches (status='live' / 'final' / 'postponed' / 'cancelled') are
// excluded — odds are pre-match only.
//
// Rows without a usable api_sports id are filtered out (we can't sync
// odds for those — same pattern as lib/liveMatches.js).

import { sql } from './db.js';

export async function getMatchesToRefreshOdds() {
  const rows = await sql`
    SELECT
      m.id,
      m.slug,
      m.kickoff_at,
      m.status,
      m.external_ids->>'api_sports' AS api_sports_id
    FROM matches m
    WHERE m.status = 'scheduled'
      AND m.kickoff_at >= now()
      AND m.kickoff_at <= now() + interval '10 days'
    ORDER BY m.kickoff_at
  `;
  return rows.filter((r) => r.api_sports_id);
}
