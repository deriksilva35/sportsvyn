// lib/draft/deadline.js - THE CLOCK, AS A FACT RATHER THAN AN ANIMATION. PURE.
//
// ============================================================================
// THE DEFECT, MEASURED: ROOM 543 SAT ON PICK 7.06 FOR HOURS
// ============================================================================
// The room's countdown was a setInterval in the client. A backgrounded tab
// does not tick it, a slept phone does not tick it, and a closed laptop does
// not tick it - so the turn never expired, the server was never asked to
// auto-pick, and the room stopped dead on a human turn that nobody was there
// to take. Every other seat was a bot waiting on one person's foreground tab.
//
// THE FIX IS NOT A BETTER TIMER. It is storing WHEN THE TURN ENDS, so that any
// later request can see that it has, and resolve it. The client countdown
// becomes what it always should have been: a rendering of a stored deadline,
// not the authority on one.
//
// EVERY FUNCTION HERE IS PURE and takes `now`, because the two things this
// module decides - "has it expired" and "how much is left" - are exactly the
// two things a test must be able to ask at a chosen instant.

/** Milliseconds from a Date, a string, or null. NaN-safe: null means absent. */
function ms(t) {
  if (t == null) return null;
  const v = t instanceof Date ? t.getTime() : new Date(t).getTime();
  return Number.isFinite(v) ? v : null;
}

/**
 * The deadline for a turn beginning now, or null for an untimed room.
 *
 * @param {number|null|undefined} timerSeconds config.pick_timer_seconds
 * @param {Date|string} now
 * @returns {Date|null}
 */
export function deadlineFrom(timerSeconds, now = new Date()) {
  const s = Number(timerSeconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  const t = ms(now);
  if (t == null) return null;
  return new Date(t + s * 1000);
}

/**
 * Has the turn on the clock expired?
 *
 * NO DEADLINE IS NOT AN EXPIRED ONE. An untimed room, and a room not resting
 * on a human turn, both store NULL - and neither may be swept.
 *
 * STRICTLY AFTER, never "at or after". A read landing on the same millisecond
 * the deadline falls is a read the player still owns; a boundary that goes the
 * other way would take a pick from somebody whose tap and deadline collided.
 */
export function isExpired(deadlineAt, now = new Date()) {
  const d = ms(deadlineAt);
  const t = ms(now);
  if (d == null || t == null) return false;
  return t > d;
}

/**
 * The seconds a client should show, from the stored deadline.
 *
 * SEEDING FROM THE DEADLINE IS THE WHOLE POINT. Before this, a reload restarted
 * the countdown at the full timer - so refreshing the page bought you another
 * thirty seconds, forever, and the number on screen was never the number the
 * server would act on.
 *
 * CLAMPED AT BOTH ENDS. Never below zero (a stale deadline shows 0, which is
 * "expired", and the next server read resolves it). Never above the room's own
 * timer, because a clock reading 45 in a 30-second room would be a clock
 * nobody could explain - a stored deadline further out than the timer means a
 * changed config or a clock skew, and the honest ceiling is the room's rule.
 *
 * ROUNDED UP. With 0.4s left the room has time on the clock, and "0" would say
 * it does not.
 *
 * @returns {number|null} null when there is no deadline to render
 */
export function remainingSeconds(deadlineAt, timerSeconds, now = new Date()) {
  const d = ms(deadlineAt);
  const t = ms(now);
  if (d == null || t == null) return null;
  const cap = Number(timerSeconds);
  const left = Math.ceil((d - t) / 1000);
  const floored = Math.max(0, left);
  return Number.isFinite(cap) && cap > 0 ? Math.min(cap, floored) : floored;
}
