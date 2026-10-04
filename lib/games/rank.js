// lib/games/rank.js - THE TIE RULE, once, for every board. PURE.
//
// RULING (sun-16 item C, queued since sat-5): tied scores share the HIGHER
// place - standard competition ranking, 1, 1, 3 - on every board, and within
// a tie the EARLIEST SUBMISSION is listed first. The place is the score's; the
// order inside a place is the clock's. Nothing else breaks a tie: not a
// secondary stat, not a handle, not a user id (the id survives only as the
// last-resort ORDER key so a redraw can never shuffle two identical rows).
//
// UNRANKED ROWS (a DNF, a card with no score, a reader below a table's floor)
// get rank null. A row with NO SCORE sorts after every scored row; a row that
// HAS a score but is not eligible (`rankedOf` false) keeps its place in the
// order and simply wears no number - the "n of 3 weeks" rows of the season
// tables, which are on the table but not yet ranked on it.
//
// THE SQL EQUIVALENT, for readers that rank in a query:
//
//   rank() OVER (ORDER BY score DESC)                    -- the place (NOT dense_rank)
//   ... ORDER BY score DESC, <submitted> ASC NULLS LAST, user_id ASC   -- the display order
//
// where <submitted> is the game's submission instant (see SUBMITTED below).
// rank() comes back from the driver as a STRING (bigint) - Number() it.
//
// WHAT "SUBMITTED" MEANS, PER GAME - the moment the reader committed:
//
//   Weekly, Pick'em (NFL/CFB weekly, NBA day, MLB series), October, The Run,
//   Six, EPL Weekly 5
//       contest_entries.submitted_at - the LAST lineup/pick write the reader
//       made (save, pick, clear), stamped by the entry's own write path and
//       never by lock, settle, regrade or confirm (migration 126). Those other
//       writers all bump updated_at, which is why updated_at cannot be used.
//   The Draft
//       contest_entries.submitted_at, stamped when the finished roster is
//       stored on the entry (lib/draft/entry.js storeRoster) - the draft's
//       completion.
//   The Daily v2
//       daily_board_runs.completed_at - the run's submit.
//   The Daily v1 (puzzle_entries)
//       puzzle_entries.locked_at - the explicit "lock it in".
//   A SEASON/AGGREGATE TABLE (season tables, October/Run standings, a league's
//   table, the Daily's main/streak/perfect/played boards)
//       the submission of the LATEST result the aggregate counts - the moment
//       the reader's total reached its current value. Of two readers on the
//       same total, the one who got there first is listed first.
//   A Draft ROOM (twelve seats, eleven of them bots)
//       the seat number - draft order, the only clock a bot has.
//
// Rows from before migration 126 fall back to created_at (see the migration's
// backfill, which recovers the real instant where the data still holds it).

export const SUBMITTED = Object.freeze({
  weekly: 'contest_entries.submitted_at',
  draft: 'contest_entries.submitted_at',
  pickem: 'contest_entries.submitted_at',
  october: 'contest_entries.submitted_at',
  run: 'contest_entries.submitted_at',
  six: 'contest_entries.submitted_at',
  epl_weekly_5: 'contest_entries.submitted_at',
  daily: 'daily_board_runs.completed_at',
  daily_v1: 'puzzle_entries.locked_at',
});

const EPS = 1e-9;

/** A score as a list of numbers (a tuple score compares lexicographically), or null. */
function scoreKey(v) {
  if (v == null) return null;
  const parts = Array.isArray(v) ? v : [v];
  const nums = parts.map((x) => (x == null || x === '' ? NaN : Number(x)));
  return nums.every(Number.isFinite) ? nums : null;
}

/** >0 when a outranks b, 0 when tied, <0 when b outranks a. */
function cmpScore(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (Math.abs(d) > EPS) return d;
  }
  return 0;
}

/** Epoch ms of a submission instant, or null. */
function msOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

const idOf = (r) => r?.userId ?? r?.user_id ?? null;

function cmpId(a, b) {
  const x = idOf(a); const y = idOf(b);
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  const nx = Number(x); const ny = Number(y);
  if (Number.isFinite(nx) && Number.isFinite(ny)) return nx - ny;
  return String(x).localeCompare(String(y));
}

/** Earliest first; a row with no instant after every row that has one. */
function cmpSubmitted(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

/**
 * PURE. Every row, ordered and placed by the tie rule.
 *
 * @param rows           any objects
 * @param scoreOf        row -> number | number[] (a tuple compares in order) | null
 * @param submittedAtOf  row -> Date | ISO string | epoch ms | null
 * @param opts.rankedOf  row -> boolean; false keeps the row in order, rank null
 * @param opts.key       the property the place is written to (default 'rank')
 * @returns new rows ({ ...row, [key]: place | null }), best first
 */
export function competitionRank(rows = [], scoreOf = (r) => r.score, submittedAtOf = (r) => r.submittedAt, { rankedOf = null, key = 'rank' } = {}) {
  const items = (rows ?? []).map((row) => ({
    row, score: scoreKey(scoreOf(row)), at: msOf(submittedAtOf(row)),
  }));
  items.sort((a, b) => {
    if (a.score == null || b.score == null) {
      if (a.score == null && b.score == null) return cmpSubmitted(a.at, b.at) || cmpId(a.row, b.row);
      return a.score == null ? 1 : -1;
    }
    return -cmpScore(a.score, b.score) || cmpSubmitted(a.at, b.at) || cmpId(a.row, b.row);
  });
  // THE PLACE: 1 + the number of RANKED rows strictly better. Walking the
  // sorted list, a ranked row that ties the previous ranked row's score keeps
  // its place; otherwise it takes 1 + (ranked rows before it).
  let seen = 0; let prev = null; let place = 0;
  return items.map((it) => {
    const eligible = it.score != null && (rankedOf == null || rankedOf(it.row) !== false);
    if (!eligible) return { ...it.row, [key]: null };
    if (prev == null || cmpScore(prev, it.score) !== 0) place = seen + 1;
    seen += 1; prev = it.score;
    return { ...it.row, [key]: place };
  });
}

/**
 * PURE. The latest of a set of submission instants, as an ISO string or null -
 * an aggregate's submission (see the header: when the total reached its value).
 */
export function latestSubmitted(values = []) {
  let best = null;
  for (const v of values ?? []) {
    const t = msOf(v);
    if (t != null && (best == null || t > best)) best = t;
  }
  return best == null ? null : new Date(best).toISOString();
}
