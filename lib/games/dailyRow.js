// lib/games/dailyRow.js — the lobby's Daily row, from the v2 board and run.
//
// THE ROW USED TO READ v1 (puzzle_days / puzzle_entries) WHILE ITS HREF WENT
// TO v2 (/daily/board) - FRESH-USER FIXES, D9. So a playable board could show
// "not available today · Locked", a finished run never flipped to Done, and
// the copy named a Pacific midnight for an Eastern close. State now comes from
// daily_boards / daily_board_runs for today's ET edition; the pieces below are
// PURE so the four states are testable from fixtures.
//
//   no board today            -> "not available today"            Locked (muted)
//   signed out                -> "{n} playing today"              no pill
//   board, no run             -> "not played · closes midnight ET" Play (volt)
//   run started, not graded   -> "in progress · closes midnight ET" In progress (volt)
//   run graded                -> "played · {pct}% of best"         Done (jade)

export const DAILY_CLOSES = 'closes midnight ET';

/**
 * @param {{ board: {id:number}|null, run: {startedAt:string|null, completedAt:string|null, pct:number|null}|null,
 *           uid: number|null, playingToday: number, edition: number|string|null }} p
 */
export function dailyRowFor({ board = null, run = null, uid = null, playingToday = 0, edition = null } = {}) {
  const line1 = edition != null ? `No. ${edition} · eight slots, twelve teams` : 'eight slots, twelve teams';
  if (board == null) return { line1, line2: 'not available today', pill: { label: 'Locked', tone: 'muted' }, tile: '' };
  if (uid == null) return { line1, line2: `${playingToday ?? 0} playing today`, pill: null, tile: '' };
  if (run?.completedAt) {
    const pct = run.pct == null ? null : Math.round(Number(run.pct) * 100);
    return { line1, line2: pct == null ? 'played' : `played · ${pct}% of best`, pill: { label: 'Done', tone: 'jade' }, tile: 'done' };
  }
  if (run?.startedAt) {
    return { line1, line2: `in progress · ${DAILY_CLOSES}`, pill: { label: 'In progress', tone: 'volt' }, tile: 'on' };
  }
  return { line1, line2: `not played · ${DAILY_CLOSES}`, pill: { label: 'Play', tone: 'volt' }, tile: 'on' };
}
