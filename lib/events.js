// lib/events.js — match_events sync atom for the live-poll path.
//
// API-Sports /fixtures/events?fixture=X returns an array of events
// (Goal, Card, subst, Var, …). Each tick of poll-live → syncFixture
// already fetches this array but currently throws it away (only the
// count goes to sync_log). This atom persists the full array using
// the same is_current flip pattern as odds_markets and match_lineups.
//
// syncMatchEvents(matchDbId, eventsArray, { homeTeamApiId,
//                                           awayTeamApiId,
//                                           fixtureApiId }):
//   1. UPDATE all current rows for this match → is_current=false
//   2. UPSERT every event in the latest feed → is_current=true
//      (ON CONFLICT DO UPDATE re-flips survivors back to current;
//       events that disappeared from the feed stay is_current=false)
//
// VAR / reversal protection: API-Sports replaces a cancelled goal with
// a Var "Goal cancelled" event — the original Goal disappears from the
// feed entirely. If our DB recorded the goal on an earlier tick, the
// is_current flip leaves it at false on every subsequent tick. The
// Key Moments timeline (filtered to is_current=true) never shows the
// phantom goal.
//
// Defensive on team_side: if event.team.id matches neither home nor
// away, default to 'home' and console.error — one bad event must not
// throw and lose the rest of the tick (Q2 from the design review).

import { sql } from './db.js';

function deriveTeamSide(eventTeamId, { homeTeamApiId, awayTeamApiId, fixtureApiId, matchDbId }) {
  if (eventTeamId === homeTeamApiId) return 'home';
  if (eventTeamId === awayTeamApiId) return 'away';
  console.error(
    `syncMatchEvents: event.team.id=${eventTeamId} matches neither home (${homeTeamApiId}) nor away (${awayTeamApiId}) ` +
      `for fixture ${fixtureApiId} (match_id=${matchDbId}); defaulting team_side='home'.`,
  );
  return 'home';
}

export async function syncMatchEvents(matchDbId, eventsArray, options = {}) {
  if (!Array.isArray(eventsArray) || eventsArray.length === 0) {
    return { written: 0, stale: 0, hadData: false };
  }

  const { homeTeamApiId, awayTeamApiId, fixtureApiId } = options;

  // Step 1: flip all current events for this match to non-current.
  // Survivors get re-flipped to true in step 2's ON CONFLICT branch;
  // disappeared events (VAR'd) stay at false.
  const staleRows = await sql`
    UPDATE match_events SET is_current = false
    WHERE match_id = ${matchDbId} AND is_current = true
    RETURNING id
  `;

  // Step 2: UPSERT each event.
  let written = 0;
  for (const e of eventsArray) {
    const minute = e?.time?.elapsed;
    if (!Number.isInteger(minute)) continue; // skip malformed entries

    const minuteExtra = Number.isInteger(e?.time?.extra) ? e.time.extra : null;
    const eventType = e?.type ?? null;
    const detail = e?.detail ?? null;
    if (!eventType) continue; // event_type is NOT NULL

    const teamApiId = e?.team?.id ?? null;
    const teamSide = deriveTeamSide(teamApiId, {
      homeTeamApiId, awayTeamApiId, fixtureApiId, matchDbId,
    });

    const playerApiId = e?.player?.id ?? null;
    const playerName = e?.player?.name ?? null;
    const assistApiId = e?.assist?.id ?? null;
    const assistName = e?.assist?.name ?? null;

    await sql`
      INSERT INTO match_events (
        match_id, minute, minute_extra, event_type, detail,
        team_side, team_api_id, player_api_id, player_name,
        assist_api_id, assist_name, raw,
        is_current, fetched_at, last_seen_at
      ) VALUES (
        ${matchDbId}, ${minute}, ${minuteExtra}, ${eventType}, ${detail},
        ${teamSide}, ${teamApiId}, ${playerApiId}, ${playerName},
        ${assistApiId}, ${assistName}, ${JSON.stringify(e)}::jsonb,
        true, now(), now()
      )
      ON CONFLICT (match_id, minute, minute_extra, event_type, detail, player_api_id)
      DO UPDATE SET
        is_current   = true,
        last_seen_at = now(),
        team_side    = EXCLUDED.team_side,
        team_api_id  = EXCLUDED.team_api_id,
        player_name  = EXCLUDED.player_name,
        assist_api_id = EXCLUDED.assist_api_id,
        assist_name  = EXCLUDED.assist_name,
        raw          = EXCLUDED.raw
    `;
    written++;
  }

  return { written, stale: staleRows.length, hadData: true };
}
