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
