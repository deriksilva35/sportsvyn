// lib/pollers/playsScope.js - WHICH games the live plays poller may touch.
//
// THE SCOPE EXCLUDES AT THE QUERY, NOT AFTER THE FETCH. That is the ratified
// rule and it is a cost control, not a style preference: a league-wide "all
// live CFB" scan filtered down afterwards would still have enumerated - and on
// a real September Saturday, still have polled - every game on the slate.
// CFB Week 2 is 79 games (6 Sep 2025, actual). At 90s each that is ~11,000
// CFBD requests in one afternoon against a 30,000/month cap. The board join
// makes that arithmetic impossible to reach by construction rather than by
// remembering to filter.
//
// The board IS the bound. Today it is 8 games; once the AP-25 inclusion rule
// ships it is ~20-25. Whatever it becomes, the poller's cost tracks it
// automatically, because the set of games it can see is defined by the join.

import { sql } from '../db.js';

/**
 * Live games that sit on an OPEN Pick'em board.
 *
 * Every clause here is load-bearing:
 *   c.game_type = 'pickem'   - other contest types do not fund this poller
 *   c.settled = false        - a graded board's games are done; nothing to poll
 *   m.status = 'live'        - the only status with plays arriving
 *   l.slug = 'cfb'           - NFL/BDL live polling is deferred to 10 Sep and
 *                              is deliberately not reachable from here
 *
 * DISTINCT because a match can legitimately appear on more than one open board
 * (a weekly and a season-long contest sharing a game); it must be polled once.
 */
export async function liveBoardGames() {
  return sql`
    SELECT DISTINCT m.id, m.slug, m.kickoff_at, m.home_team_id, m.away_team_id
      FROM contests c
      CROSS JOIN LATERAL jsonb_array_elements(c.board) g
      JOIN matches m ON m.id = (g->>'match_id')::int
      JOIN leagues l ON l.id = m.league_id
     WHERE c.game_type = 'pickem'
       AND c.settled = false
       AND m.status = 'live'
       AND l.slug = 'cfb'
     ORDER BY m.kickoff_at`;
}

/**
 * When each of those games was last written to. `plays.updated_at` is the
 * honest record of a completed poll: writePlays does ON CONFLICT DO UPDATE on
 * every row every time, so a successful fetch always moves it, even when the
 * feed returned nothing new.
 *
 * A game with no plays row yet has no timestamp and is therefore always due -
 * correct, since that is exactly the game we most want to start reading. The
 * cost is bounded: a live game with an empty feed is a short window, and the
 * board join already caps how many can exist at once.
 */
export async function lastPolledAt(matchIds) {
  if (!matchIds?.length) return new Map();
  const rows = await sql`
    SELECT match_id, max(updated_at) AS at FROM plays
     WHERE match_id = ANY(${matchIds}) GROUP BY match_id`;
  return new Map(rows.map((r) => [r.match_id, r.at]));
}

/**
 * Which of the in-scope games are due for a poll this tick. Pure, so the
 * cadence rule can be tested without a database or a clock.
 */
export function dueForPoll(games, lastPolled, intervalSec, now = new Date()) {
  const cutoff = now.getTime() - intervalSec * 1000;
  return (games ?? []).filter((g) => {
    const at = lastPolled?.get?.(g.id) ?? null;
    if (at == null) return true;                 // never polled - always due
    return new Date(at).getTime() <= cutoff;
  });
}
