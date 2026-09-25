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
 * CFB_PLAYS_ALL=on widens CFB from the board to EVERY live game with an FBS
 * side. Off unless explicitly on - a missing env var is off, and off is main.
 *
 * THE ARITHMETIC CHANGED, NOT THE RULE. On CFBD's Tier 3 (75,000 calls/month,
 * read from /info on 25 Sep 2026) a full Saturday measures out: 19 Sep polled
 * 20 board games for 2,124 calls, ~106 per game at the every-other-minute
 * cadence below, so a 65-game Saturday is ~6,900 plays calls on top of ~900
 * for everything else, and the heaviest month (October, ~290 FBS games) is
 * ~45,000 of 75,000 with the rest of the product's CFBD traffic included.
 * FCS v FCS stays out: nothing on this product draws those games' strips.
 */
export function cfbPlaysAll(env = process.env) {
  return String(env?.CFB_PLAYS_ALL ?? '').trim().toLowerCase() === 'on';
}

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
export async function liveBoardGames({ all = cfbPlaysAll() } = {}) {
  // NFL: EVERY LIVE GAME. A live NFL game is worth a strip whether Pick'em
  // carries it or not, and the arithmetic allows it: a Sunday early window
  // is at most ~10 concurrent games, one BDL request per game per 90 s
  // (two once a game passes 100 plays) - ~7-14 requests a minute for three
  // hours, ~1,400 a day at the busiest, against BDL's per-minute tier.
  // CFB: STILL THE BOARD. The header above is the ruling and its numbers
  // still hold - 79 live games at 90 s is ~11,000 CFBD requests in one
  // afternoon against a 30,000/month cap. The board join stays the bound.
  return sql`
    SELECT DISTINCT m.id, m.slug, m.kickoff_at, m.home_team_id, m.away_team_id, l.slug AS league
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
     WHERE m.status = 'live'
       AND (
         l.slug = 'nfl'
         OR (l.slug = 'cfb' AND EXISTS (
           SELECT 1 FROM contests c
            CROSS JOIN LATERAL jsonb_array_elements(c.board) g
            WHERE c.game_type = 'pickem' AND c.settled = false
              AND (g->>'match_id')::int = m.id))
         -- CFB_PLAYS_ALL: every live game with an FBS side. Still a join, still
         -- bounded - by the flag and by the FBS clause - never a bare league scan.
         OR (l.slug = 'cfb' AND ${all}::boolean AND EXISTS (
           SELECT 1 FROM teams t
            WHERE t.id IN (m.home_team_id, m.away_team_id)
              AND t.metadata->>'classification' = 'fbs'))
       )
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
