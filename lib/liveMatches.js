// lib/liveMatches.js — selects matches the cron should poll right now.
//
// Predicate:
//   status = 'live'
//   OR (status = 'scheduled' AND kickoff_at within [now()-4h, now()+15m])
//
// The 15-minute look-ahead arms the poller before kickoff so the very
// first poll catches lineups + the NS→1H transition. The 4-hour
// look-behind on scheduled rows is a safety net: if API-Sports never
// flips a match to 'live' or 'final', we stop polling it 4h after
// kickoff instead of polling forever.
//
// Returns rows with the API-Sports fixture id pulled out of external_ids
// so the cron can hand them straight to syncFixture(). Rows without a
// usable api_sports id are filtered out (we can't sync those).

import { sql } from './db.js';

export async function getMatchesToPoll() {
  const rows = await sql`
    SELECT
      m.id,
      m.slug,
      m.kickoff_at,
      m.status,
      m.external_ids->>'api_sports' AS api_sports_id
    FROM matches m
    WHERE
      m.status = 'live'
      OR (
        m.status = 'scheduled'
        AND m.kickoff_at <= now() + interval '15 minutes'
        AND m.kickoff_at >= now() - interval '4 hours'
      )
    ORDER BY m.kickoff_at
  `;
  return rows.filter((r) => r.api_sports_id);
}
