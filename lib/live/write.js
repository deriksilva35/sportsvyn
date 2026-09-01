// lib/live/write.js — what the live poller is allowed to write, and nothing
// else.
//
// THE POLLER OWNS A SUBSET: status, home_score, away_score,
// metadata.live_state, metadata.detail.final_seen_at. It does NOT write
// drives, plays, line_scores, broadcasts, kickoff_at, teams or week. Those
// have their own writers on their own cadences, and a 30-second loop reaching
// into them would race every one of them.
//
// D5 - NEVER NULL A SCORE. Both feeds leave the score null for stretches of a
// live game (CFBD until `completed`, BDL until the box is final), and writing
// that null over a running score is what took the 29 Aug opener's scoreboard
// blank for 20 seconds a tick, all slate long. Incoming non-null wins; incoming
// null preserves. There is no `scheduled` arm here, unlike the games upsert:
// this writer only ever touches rows it has just seen live or finalling, so the
// case that arm exists for cannot arise.
//
// D6 - LIVE_STATE DIES WITH THE GAME. A clock that outlives the game it
// described is a stale fact with no owner; every consumer guards on
// status = 'live' today, which makes it inert rather than absent, and inert is
// how a stale clock becomes visible later.
//
// THE MERGE IS EXPLICIT AT EVERY LEVEL. `jsonb ||` is one level deep:
// live_state is top-level so a top-level merge is correct for it, and
// final_seen_at is nested under `detail` so its merge is written out. That is
// the 14 Aug law, and the wipe it is named after cost the slate its flap
// immunity.

/**
 * The one statement. Returns the row's new state so the caller can decide
 * whether a score actually changed - it must not have to ask again.
 *
 * FINAL_SEEN_AT IS SET-ONCE, re-asserted after the merge exactly as
 * writeDetailStamp does it: the point of a timestamp is that it cannot be
 * walked backwards, which is worth nothing if a later writer can clear it.
 */
export async function writeLive(sql, matchId, { status, homeScore, awayScore, liveState }) {
  const rows = await sql`
    UPDATE matches SET
      status = COALESCE(${status}::text, status),
      home_score = COALESCE(${homeScore}::int, home_score),
      away_score = COALESCE(${awayScore}::int, away_score),
      metadata = COALESCE(metadata, '{}'::jsonb)
        || jsonb_build_object('live_state',
             CASE WHEN COALESCE(${status}::text, status) = 'live'
                  THEN ${liveState == null ? null : JSON.stringify(liveState)}::jsonb
                  ELSE 'null'::jsonb END)
        || CASE WHEN ${status}::text = 'final' THEN jsonb_build_object(
             'detail',
             COALESCE(metadata->'detail', '{}'::jsonb)
               || jsonb_build_object('final_seen_at',
                    COALESCE(metadata->'detail'->>'final_seen_at',
                             to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')))
           ) ELSE '{}'::jsonb END,
      updated_at = now()
    WHERE id = ${matchId}
    RETURNING id, status, home_score, away_score,
              (metadata->'detail'->>'final_seen_at') AS final_seen_at`;
  return rows[0] ?? null;
}

/**
 * Did the score move? PURE, and it takes BOTH readings rather than a diff,
 * because "changed" has to mean changed from what WE held - not from what the
 * previous poll of this process happened to see. A restarted loop has no
 * previous poll and must still not re-emit every score on the board.
 */
export function scoreChanged(before, after) {
  if (!after) return false;
  const n = (v) => (v == null ? null : Number(v));
  return n(before?.home_score) !== n(after.home_score)
      || n(before?.away_score) !== n(after.away_score);
}
