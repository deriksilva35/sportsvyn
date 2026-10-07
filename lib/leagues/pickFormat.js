// lib/leagues/pickFormat.js - HOW A LEAGUE SCORES ITS PICK'EM (S2, wed-1). PURE
// and client-safe: the create sheet, the league page and the server read the
// same rules.
//
//   REGULAR     one point per winner, counted from the lineup. A confidence
//               board's stored score is POINTS, so it is re-counted to wins.
//   CONFIDENCE  the board's own score: rank points on a confidence board, and
//               on a board that was never ranked (before 20 Oct) its wins -
//               there are no ranks to score.
//   ATS         RESERVED (migration 133 allows it); never offered, refused here.
//
// League totals are RAW points of whichever format: "total" scoring adds them
// up, "rank" scoring ranks members on them per unit, exactly as for any game.
//
// THE LOCK. A format can change freely until the league's first week locks
// (its starts_at, the first counted kickoff). After that it is the season's.
// A league that existed BEFORE S2 has a ONE-TIME switch (pick_format_switch_open):
// it applies from the 20 Oct 2026 week at the earliest - and never to a week
// already under way - and every earlier week stays as it was scored.

import { correctCount, CONFIDENCE_START } from '../pickem/confidence.js';

export const PICK_FORMATS = Object.freeze(['regular', 'confidence']);
export const PICK_FORMAT_LABEL = Object.freeze({ regular: 'Regular', confidence: 'Confidence', ats: 'Against the spread' });

/** The create sheet's and the switch's title (mock copy, verbatim). */
export const PICK_FORMAT_TITLE = 'How should your league score?';
/** The two cards: body and tag (mock copy, verbatim). */
export const PICK_FORMAT_COPY = Object.freeze({
  regular: 'Pick the winner of every game. One point each.',
  confidence: 'Pick winners, then rank them. Your surest pick is worth the most.',
});
export const PICK_FORMAT_TAG = Object.freeze({
  regular: 'Easiest to start',
  confidence: 'Same as the public game',
});
export const PICK_FORMAT_LOCK_NOTE = "You can change this until your league's first week locks. After that, a change starts next season.";

/** The earliest a one-time switch can take effect: the 20 Oct 2026 week. */
export const SWITCH_EARLIEST = CONFIDENCE_START;

export const PICK_FORMAT_REFUSALS = Object.freeze({
  bad_pick_format: 'Pick how your league scores',
  no_pickem: "Only a league that plays Pick'em has a scoring format",
  same: 'That is already how this league scores',
  not_owner: 'Only the commissioner can change the format',
  locked: "The format is set for this season. A change starts next season.",
  not_pending: 'Nothing is queued',
});

export const leaguePlaysPickem = (games = []) => games.includes('pickem');

/** Raw input -> a stored value. Missing is REGULAR (the default every old caller gets). */
export function validatePickFormat(raw) {
  if (raw == null || raw === '') return { ok: true, pickFormat: 'regular' };
  const v = String(raw).trim().toLowerCase();
  if (!PICK_FORMATS.includes(v)) return { ok: false, reason: PICK_FORMAT_REFUSALS.bad_pick_format, code: 'bad_pick_format' };
  return { ok: true, pickFormat: v };
}

/** Has the league's first week locked? (starts_at is its first counted kickoff.) */
export const formatLocked = (lg, now = new Date()) => lg?.starts_at != null && new Date(lg.starts_at) <= new Date(now);

/** The format a contest locking at `locksAt` is scored on in this league. */
export function formatAt(lg, locksAt) {
  const cur = lg?.pick_format ?? 'regular';
  if (lg?.pick_format_from == null) return cur;
  return new Date(locksAt) < new Date(lg.pick_format_from) ? (lg.pick_format_prev ?? 'regular') : cur;
}

/**
 * One Pick'em entry's LEAGUE score under a format. row: { conf, score, lineup, results }
 * - conf: the board is a confidence board; results: contests.perfect.results.
 */
export function pickemLeagueScore(format, row) {
  if (format === 'confidence') return row.score == null ? null : Number(row.score);
  // REGULAR: a confidence board's stored score is points; count the wins.
  if (row.conf === true) return row.settled && row.results ? correctCount(row.lineup ?? {}, row.results) : null;
  return row.score == null ? null : Number(row.score);
}

/** W-L from a lineup and a board's results; void/tie games count as neither. */
export function pickemRecord(lineup = {}, results = {}) {
  let w = 0; let l = 0;
  for (const [id, side] of Object.entries(lineup ?? {})) {
    const res = results?.[id];
    if (res !== 'home' && res !== 'away') continue;
    if (side === res) w += 1; else l += 1;
  }
  return { w, l };
}

export const recordLine = (r) => (r ? `${r.w}-${r.l}` : '');

/**
 * Can the commissioner change the format now, and from when?
 *   lg: { pick_format, pick_format_switch_open, starts_at, games }
 *   weekStartsAt: the instant the first week NOT yet under way begins (the
 *     server works it out from the schedule: this Tuesday 00:00 ET, or next
 *     Tuesday's when a board of this week has already locked).
 * -> { ok, kind: 'set'|'switch'|'queue'|'clear', from } | { ok: false, reason, code }
 */
export function planFormatChange(lg, next, { now = new Date(), isOwner = true, weekStartsAt = null } = {}) {
  const fail = (code) => ({ ok: false, reason: PICK_FORMAT_REFUSALS[code], code });
  if (!isOwner) return fail('not_owner');
  if (!PICK_FORMATS.includes(next)) return fail('bad_pick_format');
  if (!leaguePlaysPickem(lg?.games ?? [])) return fail('no_pickem');
  const locked = formatLocked(lg, now);
  if ((lg?.pick_format ?? 'regular') === next) {
    // Choosing the current format while one is queued withdraws the queue.
    return locked && lg?.pick_format_pending ? { ok: true, kind: 'clear', from: null } : fail('same');
  }
  if (!locked) return { ok: true, kind: 'set', from: null };
  // AFTER THE LOCK a pre-S2 league may spend its one-time switch; every other
  // change is QUEUED and starts next season (lib/leagues/rollover.js).
  if (!lg?.pick_format_switch_open) return { ok: true, kind: 'queue', from: null };
  const floor = new Date(SWITCH_EARLIEST).getTime();
  const wk = weekStartsAt ? new Date(weekStartsAt).getTime() : floor;
  return { ok: true, kind: 'switch', from: new Date(Math.max(floor, wk)).toISOString() };
}

/** Does the league page offer the switch to this reader? */
export function switchOffer(lg, { now = new Date(), isOwner = false } = {}) {
  if (!isOwner || !leaguePlaysPickem(lg?.games ?? [])) return null;
  const cur = lg?.pick_format ?? 'regular';
  const to = PICK_FORMATS.find((f) => f !== cur);
  if (!formatLocked(lg, now)) return { to, kind: 'set' };
  if (lg?.pick_format_pending) return null;   // the queued change shows its Undo instead
  return { to, kind: lg?.pick_format_switch_open ? 'switch' : 'queue' };
}

/** "Switches to Confidence next season" - null when nothing is queued. */
export function pendingLine(lg) {
  const p = lg?.pick_format_pending;
  return p && p !== (lg?.pick_format ?? 'regular') ? `Switches to ${PICK_FORMAT_LABEL[p]} next season` : null;
}
