// lib/mlb/playsSync.js - one game's pitch-by-pitch into `plays`.
//
// THE SECOND WRITER WITH NO CALLER. fetchMlbPlays() and writeMlbPlays() were
// built with migration 111's six columns and wired to nothing, exactly as
// fetchMlbStats/writeMlbStats were before lib/mlb/statsSync.js - so `plays`
// held ZERO baseball rows for every game ever played, and the Plays tab was
// specified against a table nothing fills. Two of these in one sport is a
// pattern worth naming: an ingest is not shipped until something calls it.
//
// IT IS statsSync's SHAPE, which is the gridiron's syncGameStats shape: one
// match id in, { matchId, rows, changed, calls } out, so the poller's existing
// StatsTracker loop drives it with no new cadence logic and all three pulls -
// football's box, baseball's box, baseball's plays - are counted the same way
// against the quota.

import { sql } from '../db.js';
import { fetchMlbPlays, writeMlbPlays } from './playsImport.js';

/**
 * @param matchId our matches.id
 * @returns { matchId, rows, changed, calls }
 */
export async function syncMlbPlays(matchId) {
  const [m] = await sql`
    SELECT m.id, m.external_ids->>'bdl_game_id' AS pid
      FROM matches m WHERE m.id = ${matchId}`;
  // A MATCH WITH NO PROVIDER ID CANNOT BE FETCHED, and saying so costs nothing;
  // guessing one would import somebody else's game.
  if (!m?.pid) return { matchId, rows: 0, changed: 0, calls: 0, skipped: 'no provider id' };

  // IT PAGES, AND SIX CALLS IS A NORMAL GAME - 527 rows for a nine-inning game,
  // measured. The real count goes back to the caller rather than an assumed 1,
  // because the quota is counted per CALL and a game's pitches are not one.
  const { rows, calls } = await fetchMlbPlays(m.pid);
  const res = await writeMlbPlays(sql, matchId, rows);
  return { matchId, rows: rows.length, changed: res?.written ?? 0, calls };
}
