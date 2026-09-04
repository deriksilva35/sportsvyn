// lib/gridiron/cfbScoreboard.js — the live score and clock for CFB.
//
// WHY A SECOND ENDPOINT AND NOT THE ONE WE ALREADY READ. Measured, not
// assumed: CFBD /games leaves homePoints/awayPoints NULL until `completed`
// flips, so sync.js's upsertGame writes NULL into home_score/away_score for
// the whole of a live game. A live CFB card therefore rendered the LIVE pill
// over an em-dash — the 29 Aug observation that produced this file.
// /scoreboard carries points, period, clock and possession on the SAME game
// id we already store as cfbd_game_id. One league-wide call, no new vendor.
//
// ITS STATUS VOCABULARY IS NOT OURS. /scoreboard says `in_progress`; our
// column says `live` (006_matches.sql's CHECK). That is exactly the silent
// empty state the gridiron notes warn about, so the map below is explicit and
// an unrecognised token is COUNTED, never coerced.
//
// SETTLED IS FINAL. This module never touches a row that is not `live` in OUR
// table. Final scores belong to the completed-games path; a scoreboard row
// arriving late must not be able to rewrite a settled result, and a pre-game
// row must not be able to invent one.

import { sql } from '../db.js';
import { liveState } from '../live/vocabulary.js';

const CFBD_BASE = 'https://apinext.collegefootballdata.com';

/**
 * /scoreboard status -> our matches.status vocabulary.
 *
 * Censused live on 29 Aug across 99 rows: {in_progress: 1, scheduled: 98}.
 * `final` is listed because a game that ends between our ticks will carry it
 * and we must recognise it in order to STOP writing, not in order to write.
 */
export const SCOREBOARD_STATUS = Object.freeze({
  in_progress: 'live',
  scheduled: 'scheduled',
  completed: 'final',
  final: 'final',
});

/**
 * CFBD period + clock -> the live_state shape every writer now uses.
 *
 * FORMERLY toLiveState(), WHICH HAD ITS OWN {short, clock} SHAPE - a second,
 * independent writer standing next to services/live-poller/poll.mjs's
 * {period, clock} (lib/live/vocabulary.js: liveState()). This code path
 * never wins the write race in production (syncCfbLiveScores yields to the
 * droplet on every tick it holds the advisory lock - confirmed on 12/12
 * recent ticks), so the {short, clock} shape it produced was dead the moment
 * it shipped: nothing ever read a row it actually wrote. Deleted rather than
 * kept in sync with a sibling - a writer that cannot win and a reader built
 * against it are two ways to be wrong, and one of them is enough. The one
 * authoritative writer is liveState(), imported above; the halftime rule
 * this function used to compute now lives in shortOf() (also lib/live/
 * vocabulary.js), the one place both the writer's period and any reader's
 * display code are reconciled.
 */

/** The scoreboard fetcher. Injected, so this module reads no env in tests. */
export function cfbdScoreboardFetcher({ base = CFBD_BASE } = {}) {
  return async () => {
    const key = process.env.CFBD_API_KEY;
    if (!key) throw new Error('CFBD_API_KEY missing in env');
    const res = await fetch(`${base}/scoreboard`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`CFBD ${res.status} on /scoreboard: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
}

/**
 * One scoreboard row -> the columns we would write, or null to skip it.
 *
 * PURE. No database, no clock, no network — so the guards below are testable
 * without any of the three.
 *
 * @param row      a /scoreboard entry
 * @param ourStatus the status ALREADY in our matches row
 */
export function scoreUpdateFor(row, ourStatus, { unknownStatuses } = {}) {
  const raw = row?.status ?? null;
  const mapped = raw == null ? null : SCOREBOARD_STATUS[raw];
  if (raw != null && mapped === undefined) {
    // FAIL LOUD, DO NOT GUESS. An unrecognised token is counted and the row is
    // skipped; coercing it could write a score onto a game in a state we do
    // not understand.
    unknownStatuses?.push(raw);
    return null;
  }
  // THE ONE GATE THAT MATTERS. We write only while the game is live in OUR
  // table AND live on the provider's. Either side disagreeing means hands off:
  // a final row keeps the completed path's scores, a scheduled row keeps its
  // absent ones.
  if (ourStatus !== 'live' || mapped !== 'live') return null;

  const home = row?.homeTeam?.points;
  const away = row?.awayTeam?.points;
  if (!Number.isFinite(Number(home)) || !Number.isFinite(Number(away))) return null;

  return {
    homeScore: Number(home),
    awayScore: Number(away),
    // The gate above already refused anything but ourStatus==='live', so
    // liveState() needs only the period and clock - the shape every writer
    // and reader now shares (lib/live/vocabulary.js).
    liveState: liveState(row?.period, row?.clock),
  };
}

/**
 * Sync live scores + live_state for one league's in-flight games.
 *
 * SCOPED BY OUR OWN TABLE, not by the payload. We enumerate the games WE hold
 * as live and look each up in the scoreboard, rather than walking 99 provider
 * rows and writing whatever they claim. The blast radius is therefore exactly
 * "games this league already has live" and cannot grow if the provider starts
 * returning more.
 *
 * THE WRITE IS A TOP-LEVEL MERGE, NOT A REPLACE. `live_state` is a flat
 * top-level key, so `metadata || jsonb_build_object('live_state', ...)` cannot
 * reach a nested sibling (the 14 Aug shallow-merge law) and leaves `drives`
 * and `line_scores` — written by other paths — intact. It is deliberately NOT
 * routed through upsertGame, whose metadata write is a wholesale replace.
 */
export async function syncCfbLiveScores(leagueId, { fetchScoreboard, now = new Date() } = {}) {
  const summary = {
    liveGames: 0, matchedRows: 0, unmatchedGames: 0,
    scoresWritten: 0, liveStateWritten: 0, skippedNotLive: 0,
    unknownStatuses: [], calls: 0,
  };

  const live = await sql`
    SELECT m.id, m.status, m.home_score, m.away_score,
           m.external_ids->>'cfbd_game_id' AS cfbd_id
      FROM matches m
     WHERE m.league_id = ${leagueId} AND m.status = 'live'`;
  summary.liveGames = live.length;
  // NO LIVE GAME, NO CALL. The tick costs nothing on a Tuesday.
  if (!live.length) return summary;

  let rows;
  try {
    rows = await fetchScoreboard();
    summary.calls = 1;
  } catch (e) {
    summary.error = String(e?.message ?? e);
    return summary;
  }
  const byId = new Map((rows ?? []).map((r) => [String(r?.id), r]));

  for (const m of live) {
    const row = m.cfbd_id == null ? null : byId.get(String(m.cfbd_id));
    if (!row) { summary.unmatchedGames += 1; continue; }
    summary.matchedRows += 1;
    const upd = scoreUpdateFor(row, m.status, { unknownStatuses: summary.unknownStatuses });
    if (!upd) { summary.skippedNotLive += 1; continue; }

    await sql`
      UPDATE matches
         SET home_score = ${upd.homeScore},
             away_score = ${upd.awayScore},
             metadata = COALESCE(metadata, '{}'::jsonb)
                        || jsonb_build_object('live_state', ${JSON.stringify(upd.liveState)}::jsonb),
             updated_at = now()
       WHERE id = ${m.id} AND status = 'live'`;
    summary.scoresWritten += 1;
    if (upd.liveState) summary.liveStateWritten += 1;
  }

  summary.unknownStatuses = [...new Set(summary.unknownStatuses)];
  return summary;
}
