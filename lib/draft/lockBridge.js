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

/**
 * FREEZE THE BOARD OF EVERY OPEN DRAFT CONTEST THAT HAS NONE (ruling sat-6).
 *
 * The board is frozen at opens_at: one per contest, used by every room of it
 * (lib/draft/frozenBoard.js contestBoardFor). The first room start freezes it
 * too, so this is the hand that does it for a week nobody has drafted yet -
 * the hourly firing after opens_at. Idempotent: a contest with a board is not
 * selected, and the freeze itself is single-winner.
 *
 * OPEN MEANS opens_at <= now < locks_at. Never before opens_at - the board is
 * the board as of the week's open, after the last week's finals - and never
 * after the lock, when no room can start.
 *
 * `freeze` is injectable for tests.
 */
export async function freezeOpenDraftBoards({ now = new Date(), freeze = null, sport = 'nfl' } = {}) {
  const due = await sql`
    SELECT c.id FROM contests c
     WHERE c.game_type = 'draft' AND c.sport = ${sport} AND NOT c.settled
       AND c.opens_at <= ${new Date(now).toISOString()}
       AND c.locks_at > ${new Date(now).toISOString()}
       AND NOT EXISTS (SELECT 1 FROM draft_contest_boards b WHERE b.contest_id = c.id)
     ORDER BY c.id`;
  let fn = freeze;
  if (!fn) {
    const [{ rankedWeekBoard }, { DRAFT_CONFIG }] = await Promise.all([
      import('../fantasy/drafts.js'), import('./contest.js'),
    ]);
    fn = (id) => rankedWeekBoard(id, DRAFT_CONFIG);
  }
  const results = [];
  for (const c of due) {
    try { results.push({ contestId: c.id, ...(await fn(c.id)) }); }
    catch (err) { results.push({ contestId: c.id, error: String(err?.message ?? err) }); }
  }
  return { contests: due.length, results };
}
