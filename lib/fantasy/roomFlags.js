/**
 * lib/fantasy/roomFlags.js — what the draft room's transient flags become after
 * an action result.
 *
 * WHY THIS IS A MODULE AND NOT AN INLINE BRANCH. The room's `revealing` flag
 * feeds isMyTurn:
 *
 *     const isMyTurn = !complete && !revealing && onClockTeam === userTeamIndex;
 *
 * so anything that leaves `revealing` stuck true tells the room it is not the
 * user's turn. That happened: confirm() set revealing before awaiting the pick,
 * and the rejection branch returned early without clearing it. The room then
 * showed "Team 3 on the clock" - third person, about the user's own seat - hid
 * every Draft button because isMyTurn was false, and stranded the error banner,
 * which is only dismissible by arming a row whose button had just disappeared.
 * A wedge that survived until the app was force-quit, on a draft the server had
 * always been perfectly happy with.
 *
 * The rule the room needs is one sentence: A REJECTED PICK MUST LEAVE THE ROOM
 * EXACTLY AS PICKABLE AS IT WAS BEFORE THE TAP. Pulled out here so that sentence
 * is executable, because the component itself cannot be rendered in this repo's
 * test runner.
 */

/**
 * Flags after an action result (makePick / timerAutoPick / setAutoDraft).
 *
 * `revealing` is false in BOTH outcomes. On success the caller re-raises it
 * around the staggered pick reveal and lowers it again when that finishes; on
 * rejection there is nothing to reveal, so the room must be handed straight
 * back to the user.
 */
export function flagsAfterResult(res) {
  if (!res || res.ok !== true) {
    return {
      revealing: false,
      armedId: null,
      err: { reason: res?.reason ?? 'unknown' },
    };
  }
  return { revealing: false, armedId: null, err: null };
}

/**
 * Flags after the user taps Draft on a row - the "arm" step.
 *
 * Clearing `err` here is what makes a stale banner disappear on the next
 * action rather than lingering over a room that has moved on.
 */
export function flagsAfterArm(playerId) {
  return { revealing: false, armedId: playerId, err: null };
}

/**
 * Is the room in a state where the user can act?
 *
 * Mirrors the room's own isMyTurn so the invariant can be asserted directly:
 * after any rejection, this must be true again for the seat on the clock.
 */
export function canAct({ complete, revealing, onClockTeam, userTeamIndex }) {
  return !complete && !revealing && onClockTeam === userTeamIndex;
}
