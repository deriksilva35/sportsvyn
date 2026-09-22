// lib/mlb/statsSync.js - one game's box score into mlb_player_game_stats.
//
// THIS FILE EXISTS BECAUSE NOTHING CALLED THE INGEST. B1 built fetchMlbStats
// and writeMlbStats and wired them to nothing, so the table stayed empty on
// every game ever played - which meant October and The Run would have settled
// every card in the product to ZERO and looked healthy doing it. Found by the
// scorer read (docs/october-first-read.md) on the first real final, one layer
// earlier than that note expected: not "the scorer disagrees" but "there is
// nothing to score".
//
// IT IS THE GRIDIRON'S syncGameStats SHAPE, deliberately: one match id in,
// {matchId, rows, changed, calls} out, so the poller's existing StatsTracker
// loop drives it with no new cadence logic and the two sports' box pulls are
// counted the same way against the quota.

import { sql } from '../db.js';
import { fetchMlbStats, writeMlbStats } from './playsImport.js';

/**
 * @param matchId our matches.id
 * @returns { matchId, rows, changed, calls }
 */
export async function syncMlbGameStats(matchId) {
  const [m] = await sql`
    SELECT m.id, m.league_id, m.external_ids->>'bdl_game_id' AS pid
      FROM matches m WHERE m.id = ${matchId}`;
  // A MATCH WITH NO PROVIDER ID CANNOT BE FETCHED, and saying so costs
  // nothing; guessing one would fetch somebody else's box score.
  if (!m?.pid) return { matchId, rows: 0, changed: 0, calls: 0, skipped: 'no provider id' };

  // fetchMlbStats RETURNS { rows, calls }, NOT AN ARRAY - it pages, so it has
  // to report how many calls it spent, and the quota accounting below wants
  // the real number rather than an assumed 1.
  const { rows, calls } = await fetchMlbStats(m.pid);
  const teams = await sql`
    SELECT id, external_ids->>'bdl_team_id' AS pid FROM teams
     WHERE league_id = ${m.league_id} AND jsonb_exists(external_ids, 'bdl_team_id')`;
  const teamIdByBdl = new Map(teams.map((t) => [t.pid, t.id]));
  const res = await writeMlbStats(sql, matchId, rows, teamIdByBdl);
  return { matchId, rows: rows.length, changed: res?.written ?? 0, calls };
}
