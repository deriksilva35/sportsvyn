// lib/pickem/sequence.js - WHERE A PICK'EM BOARD SITS IN ITS SPORT'S
// SEQUENCE. One ordering key, defined once, called by every reader.
//
// THE DEFECT THIS CLOSES (relay 4, found on PROD 7 Sep 2026). Board order
// and board numbering were both keyed on `opens_at`, in four separate
// copies of `count(opens_at < mine) + 1` plus an untied
// `ORDER BY opens_at DESC LIMIT 1`. opens_at is NOT unique per sport and
// never was: lib/weekly/create.js's tuesdayBefore() is "the 9am ET Tuesday
// ON OR BEFORE a kickoff", so any two consecutive boards whose first games
// fall in one Tue-to-Mon span get the SAME opens_at. CFB week 36 (first
// game Thu Sep 3) and week 37 (first game Mon Sep 7) both opened Tue Sep 1.
//
// What that cost, live: the untied ORDER BY resolved the tie to the SETTLED
// board, so an open board with 24 games locking that afternoon was
// unreachable from /games and from /pickem/cfb, and both surfaces
// advertised a board that had already been graded as "opens Tue Sep 1".
// The count, being strict `<`, numbered BOTH boards 2.
//
// THE KEY IS THE FIRST KICKOFF, NOT THE OPEN. A board's place in the season
// is decided by when its games are played; when its doors opened is a
// scheduling convenience that two boards can share. locks_at IS that first
// kickoff - lib/pickem/create.js sets `locksAt = slate[0].kickoff_at` off a
// kickoff-ordered slate - so it is the stored form of the key, and
// boardsAgreeOnFirstKickoff() below is asserted in the tests so that
// equivalence cannot quietly rot.
//
// (locks_at, id) IS THE FULL KEY. Two boards of one sport sharing a first
// kickoff would be a genuine data fault rather than a scheduling artefact,
// but a total order must still be total: id breaks the tie so that nothing
// downstream can ever depend on which row Postgres felt like returning.

import { sql } from '../db.js';

/**
 * Every board of a sport in sequence order, each carrying its boardNumber.
 * THE ONE DEFINITION. Everything else in this file is expressed in terms of
 * it, and every caller outside it goes through one of these exports.
 */
export async function boardSequence({ sport }) {
  const rows = await sql`
    SELECT id, sport, season_year, week, opens_at, locks_at, settled, settled_at
      FROM contests
     WHERE game_type = 'pickem' AND sport = ${sport}
     ORDER BY locks_at ASC, id ASC`;
  return rows.map((r, i) => ({ ...r, board_number: i + 1 }));
}

/**
 * The board number a contest holds, without loading the whole sequence:
 * 1 + the count of same-sport boards that come earlier under the SAME key.
 * The ROW comparison is the point - it is (locks_at, id) as one ordered
 * pair, which is exactly what boardSequence() sorts by, so the two can
 * never disagree the way four hand-written counts did.
 */
export async function boardNumberFor({ sport, locksAt, id }) {
  const [{ n }] = await sql`
    SELECT count(*) AS n FROM contests
     WHERE game_type = 'pickem' AND sport = ${sport}
       AND (locks_at, id) < (${new Date(locksAt).toISOString()}::timestamptz, ${Number(id)}::int)`;
  return Number(n) + 1;
}

/**
 * The board number a NOT-YET-CREATED board would hold, from its planned
 * first kickoff. Same key; a plan has no id yet, so it sorts after every
 * existing board sharing that kickoff, which is what creating it would do.
 */
export async function plannedBoardNumberFor({ sport, locksAt }) {
  const [{ n }] = await sql`
    SELECT count(*) AS n FROM contests
     WHERE game_type = 'pickem' AND sport = ${sport}
       AND locks_at <= ${new Date(locksAt).toISOString()}::timestamptz`;
  return Number(n) + 1;
}

/**
 * THE BOARD A SURFACE LEADS WITH.
 *
 * Among the boards whose doors are open (opens_at <= now):
 *   1. an UNSETTLED board beats a settled one. A graded board is still
 *      reachable - it is what this returns when nothing newer is open, so
 *      the receipt survives - but it must never hide a board somebody can
 *      still play. That is the whole live defect, in one ORDER BY term.
 *   2. then the LATEST first kickoff, which is the sequence key.
 *   3. then the highest id, so the order is total.
 *
 * ONE EDGE, NAMED RATHER THAN LEFT TO CHANCE: two unsettled boards open at
 * once resolves to the LATER one, per the relay's "ordered by first kickoff
 * desc". The earlier board is still live at its own URL and still locks on
 * its own games; what this decides is only which one a surface leads with.
 */
export async function currentPickemBoard({ sport = null, now = new Date() } = {}) {
  const r = await sql`
    SELECT id, sport, season_year, week, board, opens_at, locks_at, settled, settled_at, meta
      FROM contests
     WHERE game_type = 'pickem' AND opens_at <= ${new Date(now).toISOString()}
       AND (${sport}::text IS NULL OR sport = ${sport})
     ORDER BY settled ASC, locks_at DESC, id DESC
     LIMIT 1`;
  const contest = r[0] ?? null;
  if (!contest) return null;
  contest.board_number = await boardNumberFor({
    sport: contest.sport, locksAt: contest.locks_at, id: contest.id,
  });
  return contest;
}

/**
 * EVERY OPEN BOARD, not just the one a surface leads with.
 *
 * currentPickemBoard answers "which board does this page show", and its whole
 * job is to pick ONE - two unsettled boards open at once resolves to the later
 * of them, by its own header. That is right for a page and wrong for anything
 * that must act on all of them: the house personas file against every board
 * the week has, and on 15 Sep they filed the NFL board and left the CFB board
 * (22 games, week 38) with no house rows at all.
 *
 * THE SPORTS ARE NUMBERED SEPARATELY and this must not assume otherwise. The
 * NFL board that Tuesday was week 2; the CFB board beside it was week 38, its
 * own season's count. Nothing here keys on a week number - a board is open if
 * it has opened and has not settled, and that is the whole test.
 *
 * OPEN MEANS STILL PICKABLE, not merely unsettled. A pickem board's locks_at
 * is its LAST kickoff - the join window's close - and past it every game on it
 * is sealed by its own per-game lock. Week 1's NFL board is unsettled right
 * now and locked since this morning; including it would file sixteen picks an
 * hour that savePick refuses one at a time, forever, until it settles.
 *
 * ORDERED by lock, then id, so a caller that reports per board reports them in
 * a stable order twice running.
 */
export async function openPickemBoards({ now = new Date() } = {}) {
  const at = new Date(now).toISOString();
  const rows = await sql`
    SELECT id, sport, season_year, week, board, opens_at, locks_at, settled, settled_at, meta
      FROM contests
     WHERE game_type = 'pickem'
       AND opens_at <= ${at}
       AND locks_at > ${at}
       AND NOT settled
     ORDER BY locks_at ASC, id ASC`;
  for (const c of rows) {
    c.board_number = await boardNumberFor({ sport: c.sport, locksAt: c.locks_at, id: c.id });
  }
  return rows;
}

/**
 * Does a board already exist covering this first kickoff? boardPlan() asks
 * before planning, so it cannot re-plan a board that is already open and
 * report it as one about to open (relay 4 item 2).
 */
export async function boardCovering({ sport, locksAt }) {
  const [row] = await sql`
    SELECT id, sport, season_year, week, opens_at, locks_at, settled
      FROM contests
     WHERE game_type = 'pickem' AND sport = ${sport}
       AND locks_at = ${new Date(locksAt).toISOString()}::timestamptz
     ORDER BY id ASC LIMIT 1`;
  return row ?? null;
}

/**
 * Test hook, not a runtime path: locks_at is only usable as "the first
 * kickoff" for as long as it actually equals it. Asserted in the tests
 * against real board jsonb so the key's premise cannot rot silently.
 */
export function firstKickoffOf(board) {
  const games = Array.isArray(board) ? board : [];
  return games.reduce((min, g) => (
    !min || new Date(g.kickoff_at) < new Date(min) ? g.kickoff_at : min), null);
}
