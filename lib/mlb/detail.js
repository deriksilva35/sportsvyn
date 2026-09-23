// lib/mlb/detail.js - the MLB metadata the poller does NOT own, and its writer.
//
// THE POLLER OWNS A SUBSET (lib/live/write.js): status, the two scores,
// metadata.live_state and metadata.detail.final_seen_at. It does not write
// line scores or plays, because in football those arrive from a different
// provider on a different cadence and a 30-second loop reaching into them
// would race their writers.
//
// BASEBALL HAS NO SUCH SECOND WRITER, and inventing one would mean fetching
// the identical /mlb/v1/games row twice. The line score and the scoring
// summary are ON the row the poller already has in hand. So this is the second
// writer - a separate statement, over separate keys, that the poller calls
// after writeLive rather than a widening of writeLive itself. The subset law
// survives: writeLive still cannot touch these keys, and this still cannot
// touch a score.
//
// THE MERGE. line_score, scoring_plays and probables are all TOP-LEVEL keys,
// so a top-level `jsonb ||` is the correct depth for them and every sibling it
// does not name - live_state, detail, the final_seen_at nested under it -
// survives untouched. That is the 14 Aug law read the right way round: `||` is
// shallow, which is exactly right when the key IS shallow and a disaster when
// it is not. Nothing here nests.

import { lineScoreOf, scoringPlaysOf } from './ingest.js';

/**
 * PURE. A RAW /mlb/v1/games row -> the keys this writer owns, or null when the
 * row carries none of them.
 *
 * IT PARSES THE ROW ITSELF rather than taking fromBdlMlb()'s output, so the
 * poller can hand it the row it already has without a second normalise and
 * without an `unmapped` bucket it would then have to throw away. The two field
 * readers are the same ones fromBdlMlb uses.
 */
export function mlbDetailOf(row) {
  // A SCHEDULE ROW IS NOT A RESULT, AND THIS IS WHERE THAT WAS MISSED. BDL
  // sends every unplayed game as `status_state: 'scheduled'` with
  // `inning_scores: []`, `hits: 0`, `errors: 0` and `scoring_summary: []` - a
  // perfectly well-formed line score of nothing. Writing it stamped a 0-0 grid
  // and an empty summary over every game on the board, which is why /mlb/game
  // had no LINE SCORE and no SCORING module: both are gated on having content,
  // and the content had been replaced by a pre-game reading four hours before
  // first pitch.
  //
  // MEASURED, on 2026-09-23's slate: 15 scheduled rows, every one of them
  // `scheduled|0 innings|0 summary`, against two in-progress rows carrying 5
  // and 3 innings with 5 scoring plays each.
  const state = String(row?.status_state ?? '').trim().toLowerCase();
  if (state === 'scheduled' || state === 'pre' || state === 'postponed') return null;

  const out = {};
  const line = lineScoreOf(row);
  // AND EVEN A STARTED GAME NEEDS AN INNING BEFORE IT HAS A LINE SCORE. A game
  // in the top of the first has no closed inning yet, and { innings: [], runs:
  // 0 } is the same empty grid by another route.
  if (line && ((line.home?.innings?.length ?? 0) > 0 || (line.away?.innings?.length ?? 0) > 0)) {
    out.line_score = line;
  }
  // AN EMPTY SUMMARY IS A FACT; A MISSING ONE IS NOT. A 0-0 game in the fourth
  // has genuinely had no scoring plays, and refusing to write [] is how a card
  // keeps showing last night's home run. But scoringPlaysOf() returns [] for a
  // row with no scoring_summary field AT ALL - a truncated payload, a shape
  // change - and writing that [] would wipe a real list on no evidence. So the
  // test is on the RAW FIELD, and only a row that actually carried the array
  // gets to say the array is empty.
  if (Array.isArray(row?.scoring_summary)) out.scoring_plays = scoringPlaysOf(row);
  return Object.keys(out).length ? out : null;
}

/**
 * ONE STATEMENT, and it NEVER touches a score or a status. Returns false when
 * there was nothing to write, so the caller can count real writes.
 *
 * SCOPED TO THE ROWS THE CALLER ALREADY DECIDED ON. This takes a match id, not
 * a slug or a provider id: the poller has already matched the row to our own
 * table and this must not get a second opinion about which game it is.
 */
export async function writeMlbDetail(sql, matchId, detail) {
  if (!detail || !Object.keys(detail).length) return false;
  await sql`
    UPDATE matches
       SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(detail)}::jsonb,
           updated_at = now()
     WHERE id = ${matchId}`;
  return true;
}

/**
 * THE PROBABLES, which are schedule data and not live data: they are published
 * the day before and stop being interesting the moment the first pitch is
 * thrown. Their own writer, so the poller never carries them.
 */
export async function writeMlbProbables(sql, matchId, probables) {
  if (!probables) return false;
  await sql`
    UPDATE matches
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('probables', ${JSON.stringify(probables)}::jsonb),
           updated_at = now()
     WHERE id = ${matchId}`;
  return true;
}

/**
 * THE statsapi gamePk, CACHED ON OUR ROW. Resolving it costs a schedule fetch
 * and a doubleheader judgement; doing that every thirty seconds for nine
 * innings would be both wasteful and a chance to change our mind mid-game
 * about which half of a doubleheader we are watching.
 *
 * SET-ONCE IN PRACTICE, because the caller only asks when the row has none.
 * external_ids is a top-level jsonb object, so the merge is top-level - and it
 * names one key, so bdl_game_id and everything else survives.
 */
export async function writeMlbGamePk(sql, matchId, gamePk) {
  if (gamePk == null) return false;
  await sql`
    UPDATE matches
       SET external_ids = COALESCE(external_ids, '{}'::jsonb)
                          || jsonb_build_object('statsapi_game_pk', ${String(gamePk)}::text),
           updated_at = now()
     WHERE id = ${matchId}`;
  return true;
}

/**
 * THE POSTED BATTING ORDERS, on their own top-level key.
 *
 * ONE KEY, TOP LEVEL, SO THE SHALLOW MERGE IS THE RIGHT DEPTH. `||` on jsonb
 * replaces whole values one level down and nothing deeper - the reason
 * metadata.detail.final_seen_at was wiped on every detail fetch in August - so
 * `lineups` gets its own key beside `detail`, `live_state` and `probables`
 * rather than being nested inside one of them. The whole object is replaced on
 * every write, which is correct: a batting order is not merged, it is re-posted.
 *
 * fetchedAt IS PART OF THE VALUE because the poller throttles on it. Without a
 * timestamp in the row, "when did we last ask" lives only in a process's head
 * and a restart asks again on the next tick, every tick.
 */
export async function writeMlbLineups(sql, matchId, lineups, { at = new Date() } = {}) {
  if (!lineups || typeof lineups !== 'object') return false;
  const value = {
    fetchedAt: new Date(at).toISOString(),
    away: Array.isArray(lineups.away) && lineups.away.length ? lineups.away : null,
    home: Array.isArray(lineups.home) && lineups.home.length ? lineups.home : null,
  };
  await sql`
    UPDATE matches
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('lineups', ${JSON.stringify(value)}::jsonb),
           updated_at = now()
     WHERE id = ${matchId}`;
  return true;
}

/**
 * PURE. Is it time to ask statsapi for this game's batting order again?
 *
 * NOT EVERY POLL. A live window polls every thirty seconds; asking a keyless,
 * undocumented-as-to-terms endpoint for fifteen scheduled games' lineups twice
 * a minute is both rude and pointless - a card is posted once and changed
 * rarely. Four hours before first pitch is when they start going up; before
 * that there is nothing to fetch.
 *
 * A POSTED CARD IS STILL RE-READ, at a slower beat, because a scratch is the
 * one thing a reader most needs to see and it lands after the card does.
 */
export function lineupDue(match, { now = new Date(), postedMs = 900_000, pendingMs = 300_000, windowMs = 14_400_000 } = {}) {
  const t = new Date(now).getTime();
  const k = match?.kickoff_at == null ? NaN : new Date(match.kickoff_at).getTime();
  if (!Number.isFinite(k)) return false;
  if (k - t > windowMs) return false;              // too early to be posted
  const held = match?.lineups ?? null;
  const at = held?.fetchedAt == null ? NaN : new Date(held.fetchedAt).getTime();
  if (!Number.isFinite(at)) return true;           // never asked
  const posted = Boolean(held.away || held.home);
  return t - at >= (posted ? postedMs : pendingMs);
}
