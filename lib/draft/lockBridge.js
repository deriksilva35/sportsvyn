// lib/draft/lockBridge.js - store the Draft's rosters at LOCK, not at settle.
//
// Ruling 27 Sep. bridgeContestRosters (lib/draft/entry.js) was the settle's
// self-heal: a room completed without persistTurn - every house persona's, and
// any room abandoned before lock - reached Tuesday with no meta.roster, so from
// Thursday to Tuesday it read 0.0 on every live Draft surface. On 27 Sep that
// was five of six week-3 entries (the four personas and one real player).
//
// SAME FUNCTION, EARLIER. Once the contest has locked no pick can change, so
// bridging then is the settle's own work done four days sooner: it fills
// blanks only (a bridged roster is never rewritten), and an abandoned room is
// auto-completed by the post-lock reconstruction the settle already uses. The
// settle still calls it; by then it is a no-op.

import { sql } from '../db.js';
import { bridgeContestRosters } from './entry.js';

/**
 * Bridge every locked, unsettled Draft contest. `bridge` is injectable for tests.
 * @returns {{ contests: number, results: Array }}
 */
export async function bridgeLockedDrafts({ now = new Date(), bridge = bridgeContestRosters, sport = 'nfl' } = {}) {
  const due = await sql`
    SELECT id FROM contests
     WHERE game_type = 'draft' AND sport = ${sport} AND NOT settled
       AND locks_at <= ${new Date(now).toISOString()}
     ORDER BY id`;
  const results = [];
  for (const c of due) {
    try { results.push({ contestId: c.id, ...(await bridge(c.id)) }); }
    catch (err) { results.push({ contestId: c.id, error: String(err?.message ?? err) }); }
  }
  return { contests: due.length, results };
}
