// lib/daily/seasonBoardRuns.js — turn a submitted picks[] into a stored
// daily_board_runs row, graded SERVER-SIDE against the board's own FROZEN
// best_roster (standing ruling: ceiling is stored on the edition, never
// recomputed at read time) - CLIENT SCORE IS NEVER TRUSTED. Every pick is
// re-validated against the stored board.board before anything is scored:
// a request naming a team not on this board, a player not on that team's
// card, or a slot the player is not eligible for is refused before grading
// ever runs, the same discipline lockEntry (lib/daily/entries.js) already
// applies to the v1 Daily.
//
// SETTLED IS FINAL. UNIQUE (board_id, user_id) is the constraint (090); this
// module never issues an UPDATE against daily_board_runs - a second submit
// for a board a user has already run is refused, not overwritten.

import { eligibleForSlot } from './boardShape.js';
import { gradeFromOptimum } from './seasonBoardGrade.js';

/**
 * Re-derive a play.roster (seasonBoardPlay.js shape) from submitted picks,
 * validated against the board's OWN frozen teams - never trusting a
 * client-supplied player/points/position. PURE.
 *
 * @param board the daily_boards row (board.board is [{key, card:[...]}, ...])
 * @param picks [{ slotIndex, teamKey, playerName }, ...]
 * @param slots the board's slot shape, e.g. boardShape.SLOTS
 * @returns { ok:true, roster, used } | { ok:false, reason }
 */
export function buildRosterFromPicks(board, picks, slots) {
  if (!Array.isArray(picks) || picks.length !== slots.length) {
    return { ok: false, reason: `expected ${slots.length} picks, got ${Array.isArray(picks) ? picks.length : typeof picks}` };
  }
  const roster = new Array(slots.length).fill(null);
  const used = new Set();
  const filledSlots = new Set();

  for (const pick of picks) {
    const { slotIndex, teamKey, playerName } = pick ?? {};
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= slots.length) {
      return { ok: false, reason: `bad slotIndex ${slotIndex}` };
    }
    if (filledSlots.has(slotIndex)) return { ok: false, reason: `slot ${slotIndex} submitted twice` };
    const team = board.board.find((t) => t.key === teamKey);
    if (!team) return { ok: false, reason: `team ${teamKey} is not on this board` };
    if (used.has(teamKey)) return { ok: false, reason: `team ${teamKey} used more than once - one player per team` };
    const player = team.card.find((p) => p.name === playerName);
    if (!player) return { ok: false, reason: `${playerName} is not on ${teamKey}'s card` };
    const slot = slots[slotIndex];
    if (!eligibleForSlot(player.position, slot)) {
      return { ok: false, reason: `${player.name} (${player.position}) is not eligible for ${slot}` };
    }
    roster[slotIndex] = { pos: slot, pick: { player, teamKey } };
    used.add(teamKey);
    filledSlots.add(slotIndex);
  }
  if (roster.some((r) => r == null)) return { ok: false, reason: 'not every slot was filled' };
  return { ok: true, roster, used };
}

/**
 * Grade and store one user's run against one board. Refuses (never
 * overwrites) a second run for the same (board, user) - the UNIQUE
 * constraint is the enforcement; this just turns that into a typed refusal.
 */
export async function submitRun(sql, { boardId, userId, picks, elapsedS, slots }) {
  const boards = await sql`SELECT * FROM daily_boards WHERE id = ${boardId}`;
  const board = boards[0];
  if (!board) return { ok: false, reason: 'no such board', status: 404 };

  const built = buildRosterFromPicks(board, picks, slots);
  if (!built.ok) return { ok: false, reason: built.reason, status: 400 };

  const optimum = { total: Number(board.ceiling), bySlot: board.best_roster };
  const grade = gradeFromOptimum({ roster: built.roster, used: built.used }, board.board, optimum, slots);

  const inserted = await sql`
    INSERT INTO daily_board_runs (board_id, user_id, picks, score, pct, matched, elapsed_s)
    VALUES (${boardId}, ${userId}, ${JSON.stringify(picks)}::jsonb, ${grade.mine},
            ${board.ceiling > 0 ? grade.mine / Number(board.ceiling) : 1}, ${grade.matchedCount}, ${elapsedS})
    ON CONFLICT (board_id, user_id) DO NOTHING
    RETURNING *`;
  if (!inserted.length) return { ok: false, reason: 'already ran this board', status: 409 };
  return { ok: true, run: inserted[0], grade };
}
