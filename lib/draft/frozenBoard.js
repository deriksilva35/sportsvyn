// lib/draft/frozenBoard.js - THE BOARD A ROOM DRAFTS IS THE BOARD IT STARTED
// WITH.
//
// ============================================================================
// WHY A ROOM CANNOT RECOMPUTE ITS OWN BOARD
// ============================================================================
// lib/draft/ourBoard.js ranks players on finals as they land, so it returns a
// different order on Thursday night than it did on Thursday afternoon. For a
// NEW room that is exactly right - the board should know what Thursday
// showed. For a RUNNING room it is a defect with three faces:
//
//   the reader's board reorders between two taps, mid-draft;
//   the RANK column disagrees with the adp_at_pick already frozen on the
//     picks that room has made, so its own value numbers stop adding up;
//   and the engine's par calculation - max(overallPick, available[0].adp) -
//     moves under the bots, so the same room re-read makes different picks.
//
// pool_snapshot_date froze WHICH FFC snapshot a room drafted from, and that
// was enough while the board WAS a snapshot. Our own board has no snapshot to
// name, so the rows themselves are the freeze (migration 105).
//
// WRITTEN ONCE, AT START, AND NEVER AGAIN. A board that could be rewritten
// would be a board that could be rewritten wrong; there is no update path here
// on purpose. A draft with no row falls back to computing one, which is what
// every draft started before this shipped will do - see poolFor.

import { sql } from '../db.js';

/**
 * Freeze this draft's board. Idempotent by primary key: a retry cannot change
 * a board that is already frozen.
 *
 * @param {number} draftId
 * @param {{rows: Array, computedAt?: Date, label?: string|null}} board
 */
export async function freezeBoard(draftId, board) {
  const rows = board?.rows ?? [];
  if (!rows.length) return { ok: false, reason: 'empty_board' };
  await sql`INSERT INTO draft_boards (draft_id, computed_at, label, rows)
            VALUES (${draftId}, ${board.computedAt ?? new Date()}, ${board.label ?? null},
                    ${JSON.stringify(rows)}::jsonb)
            ON CONFLICT (draft_id) DO NOTHING`;
  return { ok: true, rows: rows.length };
}

/**
 * The frozen board, or null if this draft never froze one.
 *
 * @returns {Promise<{computedAt: Date, label: string|null, rows: Array}|null>}
 */
export async function frozenBoard(draftId) {
  const [row] = await sql`SELECT computed_at, label, rows FROM draft_boards
                           WHERE draft_id = ${draftId} LIMIT 1`;
  if (!row) return null;
  const rows = Array.isArray(row.rows) ? row.rows : [];
  if (!rows.length) return null;
  return { computedAt: row.computed_at, label: row.label ?? null, rows };
}

// ============================================================================
// ONE BOARD PER RANKED WEEK (rulings D1 + sat-6, migration 125)
// ============================================================================
// "Everyone at seat N starts from the same room" needs the same BOARD as well
// as the same dice (lib/draft/roomSeed.js). Every ranked room of a contest
// copies its board from draft_contest_boards: ONE row per contest, frozen at
// the contest's opens_at.
//
// AT opens_at, BY TWO HANDS, and either is enough:
//   - the hourly draft-bridge cron freezes every OPEN contest that has no
//     board yet (lib/draft/lockBridge.js freezeOpenDraftBoards);
//   - the first room start of the week, which can come before that cron's
//     next firing - rooms open at opens_at, so the first start IS the moment.
// Nothing builds a board before opens_at: the route and the house only start
// rooms in a contest that has opened.
//
// BUILT ONCE, UNDER A LOCK. The build is the heaviest read in this game, so a
// per-contest advisory lock keeps two first rooms from both computing it; the
// one that loses the lock waits for the winner's row rather than building its
// own. The INSERT is ON CONFLICT DO NOTHING and every caller READS BACK, so
// even with the lock unavailable (it degrades to unlocked) there is exactly
// one board per contest and everybody gets the winner's.
//
// THE SOURCE OF A MISSING BOARD, in order:
//   1. the EARLIEST room of this contest that froze its own board before this
//      table existed - so a week already open on the day this ships keeps the
//      board its first rooms drafted rather than starting a second one;
//   2. `compute()` - lib/draft/ourBoard.js, the board as of now.

const WAIT_STEP_MS = 500;
const WAIT_STEPS = 40;

async function readContestBoard(contestId) {
  const [row] = await sql`SELECT computed_at, label, rows FROM draft_contest_boards
                           WHERE contest_id = ${contestId} LIMIT 1`;
  const rows = Array.isArray(row?.rows) ? row.rows : [];
  return rows.length ? { computedAt: row.computed_at, label: row.label ?? null, rows } : null;
}

/** The contest's frozen board, or null. Never builds. */
export async function contestBoard(contestId) {
  return readContestBoard(contestId);
}

/**
 * The frozen board for one ranked contest, freezing it if this is the first ask.
 *
 * @param {number} contestId
 * @param {() => Promise<{rows: Array, computedAt?: Date, label?: string|null}>} compute
 * @param {{lock?: Function}} [deps]  withAdvisoryLock, injectable for tests
 * @returns {Promise<{computedAt: Date, label: string|null, rows: Array}|null>}
 */
export async function contestBoardFor(contestId, compute, { lock = null } = {}) {
  const have = await readContestBoard(contestId);
  if (have) return have;

  const build = async () => {
    const again = await readContestBoard(contestId);
    if (again) return again;
    const [earliest] = await sql`
      SELECT b.computed_at, b.label, b.rows
        FROM contest_entries e
        JOIN draft_boards b ON b.draft_id = (e.meta->>'draftId')::int
       WHERE e.contest_id = ${contestId} AND e.meta ? 'draftId'
       ORDER BY b.draft_id ASC LIMIT 1`;
    const board = earliest && Array.isArray(earliest.rows) && earliest.rows.length
      ? { computedAt: earliest.computed_at, label: earliest.label ?? null, rows: earliest.rows }
      : await compute();
    if (!board?.rows?.length) return null;
    await sql`INSERT INTO draft_contest_boards (contest_id, computed_at, label, rows)
              VALUES (${contestId}, ${board.computedAt ?? new Date()}, ${board.label ?? null},
                      ${JSON.stringify(board.rows)}::jsonb)
              ON CONFLICT (contest_id) DO NOTHING`;
    return readContestBoard(contestId);
  };

  const withLock = lock ?? (await import('../pollers/lock.js')).withAdvisoryLock;
  const out = await withLock(`draft-board:${contestId}`, build);
  if (!out.locked) return out.result;
  // SOMEBODY ELSE IS BUILDING IT. Wait for their row; never build a second.
  for (let i = 0; i < WAIT_STEPS; i++) {
    await new Promise((r) => setTimeout(r, WAIT_STEP_MS));
    const r = await readContestBoard(contestId);
    if (r) return r;
  }
  return null;
}
