// lib/fantasy/tracker.js — PURE helpers for tracker mode (live in-person draft
// companion). No DB, no React — same testability contract as roster.js/config.js.
//
// Tracker mode vs sim mode, in one line each:
//   sim     — you draft against the engine. It picks for the other 11 seats.
//   tracker — you are AT a real draft. You record every seat's pick as it happens.
//             No engine, no clock. The app is a ledger, not an opponent.
//
// What lives here is only what is pure: the mode vocabulary, seat-label
// normalization, and the "who is on the clock" naming. The flow (entitlement,
// persistence, undo) is in drafts.js because it needs the DB.

export const MODE_SIM = 'sim';
export const MODE_TRACKER = 'tracker';
export const MODES = [MODE_SIM, MODE_TRACKER];

export const isTracker = (draftOrMode) =>
  (typeof draftOrMode === 'string' ? draftOrMode : draftOrMode?.mode) === MODE_TRACKER;

// A seat label is a real person's name typed at a real draft table, so it is
// untrusted free text. Bound it: trimmed, collapsed whitespace, length-capped.
// Empty/blank becomes null so seatLabel() falls back to "Team N" rather than
// rendering a void.
export const MAX_LABEL_LEN = 24;

export function cleanLabel(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL_LEN);
  return s.length ? s : null;
}

/**
 * Normalize a client-supplied labels array to exactly teamsCount entries.
 *
 * Returns { ok, labels } — never throws, never partially applies. Length is
 * enforced HERE rather than by a DB CHECK because the authoritative team count
 * lives on draft_configs, which a CHECK on drafts cannot reach.
 *
 * A caller may pass null/undefined (labels are optional — an unlabelled tracker
 * draft renders "Team N" throughout), but a WRONG-LENGTH array is an error, not
 * something to silently pad: it means the client and the config disagree about
 * how many teams are in the league, and guessing which is right would put the
 * wrong name on the clock.
 */
export function normalizeTeamLabels(labels, teamsCount) {
  if (labels == null) return { ok: true, labels: null };
  if (!Array.isArray(labels)) return { ok: false, reason: 'labels_not_array' };
  if (labels.length !== teamsCount) {
    return { ok: false, reason: 'labels_length', detail: `${labels.length} labels for ${teamsCount} teams` };
  }
  const out = labels.map(cleanLabel);
  // All-blank is the same as unlabelled; store NULL rather than [null,null,...].
  return { ok: true, labels: out.some((l) => l != null) ? out : null };
}

/**
 * Display name for a seat. `labels` is the stored array (or null).
 *
 * The user's own seat always reads "You" — in a live room the one thing you must
 * never misread is whether the pick on the clock is yours. A stored label for
 * your own seat is kept as a parenthetical rather than dropped, so a user who
 * typed their own name still sees it.
 */
export function seatLabel(labels, teamIndex, userTeamIndex = null) {
  const own = userTeamIndex != null && teamIndex === userTeamIndex;
  const given = Array.isArray(labels) ? cleanLabel(labels[teamIndex]) : null;
  if (own) return given ? `You (${given})` : 'You';
  return given ?? `Team ${teamIndex + 1}`;
}

// Short form for dense surfaces (the board grid cell, the pick ticker), where
// "Team 11" and a long name both need to fit a narrow column.
export function seatLabelShort(labels, teamIndex, userTeamIndex = null, max = 10) {
  if (userTeamIndex != null && teamIndex === userTeamIndex) return 'YOU';
  const given = Array.isArray(labels) ? cleanLabel(labels[teamIndex]) : null;
  if (!given) return String(teamIndex + 1);
  return given.length <= max ? given : `${given.slice(0, max - 1)}…`;
}

/**
 * The user's NEXT pick after `fromOverall` (exclusive), or null if they have none
 * left. `order` is the snake order array (overall-1 -> teamIndex), which the room
 * already holds — so "when do I pick again" costs nothing new.
 */
export function nextUserOverall(order, userTeamIndex, fromOverall) {
  const start = Math.max(0, fromOverall); // order is 0-indexed; fromOverall is 1-based
  const i = order.indexOf(userTeamIndex, start);
  return i === -1 ? null : i + 1;
}

/**
 * Picks between now and the user's next turn — "how long is the wait", the number
 * a live drafter actually reads off the screen.
 */
export function picksUntilUserTurn(order, userTeamIndex, currentOverall) {
  const next = nextUserOverall(order, userTeamIndex, currentOverall - 1);
  return next == null ? null : next - currentOverall;
}
