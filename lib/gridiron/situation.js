// lib/gridiron/situation.js - THE DOWN, THE DISTANCE AND THE SPOT NOW. PURE.
//
// ONE SOURCE FOR THREE SURFACES: the Live Activity's situation line
// (lib/push/liveActivityState.js liveLine), the Scores card's drive strip
// (lib/gridiron/scoresV2Shape.js driveStripFor) and the gamecast strip's
// headline (components/gridiron/Gamecast.js DriveStrip). On 26 Sep the web card
// printed "3rd & 3" under a third-down incompletion while the phone, reading
// this derivation, printed "4th & 3": the web was showing the play's own snap,
// which is the state BEFORE it.
//
// THE PLAY-BY-PLAY LIST IS NOT A READER OF THIS. Each row there is a play and
// its own snap is the right label for it; only the "now" headline moves.

import { lastLivePlay, lastActionPlay, byGameClock } from './driveStrip.js';

/**
 * THE STATE AFTER A PLAY, from its stored numbers alone. PURE. CARD ONLY.
 *
 * A PLAY ROW'S down, distance and yards_to_goal ARE ITS SNAP - the state
 * BEFORE it. The gamecast strip pairs that snap with the play's text on
 * purpose; a lock screen reads as "now", and on 24 Sep it printed
 * "1st & 14 · ATL 4" under the very run that had just gone to the ATL 13.
 *
 * NUMBERS ONLY, NEVER THE TEXT: down, distance, yards_to_goal, yards_gained
 * and the play's type. Only a plain rush, reception, incompletion or sack
 * with no score is derived; a penalty, turnover, kick, score, safety or a
 * failed fourth down returns null, and the card says nothing rather than
 * something stale.
 *
 * @returns {{ down, distance, yardsToGoal }} or null
 */
const PLAIN_PLAYS = new Set(['rush', 'pass-reception', 'pass-incompletion', 'sack']);
const typeKey = (t) => String(t ?? '').trim().toLowerCase().replace(/\s+/g, '-');
const whole = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));

export function afterSnap(play) {
  if (!play || !PLAIN_PLAYS.has(typeKey(play.playType))) return null;
  if (play.scoring) return null;
  const down = whole(play.down);
  const distance = whole(play.distance);
  const ytg = whole(play.yardsToGoal);
  const gained = whole(play.yardsGained);
  if (down == null || distance == null || ytg == null || gained == null) return null;
  if (down < 1 || down > 4 || distance < 1 || ytg < 1 || ytg > 99) return null;
  const spot = ytg - gained;
  // Across the goal line is a score, behind its own is a safety - neither is
  // a snap this function can name.
  if (spot < 1 || spot > 99) return null;
  if (gained >= distance) return { down: 1, distance: Math.min(10, spot), yardsToGoal: spot };
  // Short on fourth down is the ball going the other way.
  if (down === 4) return null;
  return { down: down + 1, distance: distance - gained, yardsToGoal: spot };
}

/**
 * THE END OF A HALF ENDS THE SITUATION. A quarter break inside a half (Q1,
 * Q3) carries the ball over - the same down at the same spot - so the card
 * keeps it; the end of the 2nd, the 4th or an overtime period does not.
 * Read off the stoppage ROWS that follow the play, by type, never by text.
 */
const END_ROWS = new Set(['end-period', 'end-of-half', 'end-of-game', 'end-of-regulation']);
export function halfEndedAfter(plays, play) {
  const ordered = byGameClock(plays);
  const at = ordered.indexOf(play);
  if (at < 0) return false;
  return ordered.slice(at + 1).some((p) => END_ROWS.has(typeKey(p?.playType))
    && (whole(p.period) ?? whole(play.period)) !== 1 && (whole(p.period) ?? whole(play.period)) !== 3);
}

/**
 * THE SITUATION NOW: the state after the last play, or null.
 *
 * Only when the last action (the words) is itself the last snap - the same row
 * - and the half has not ended since; otherwise null, and every surface says
 * nothing rather than something stale. { down, distance, yardsToGoal,
 * offenseTeamId } - the offense is the snap's, since a plain play that
 * afterSnap can derive never changes possession.
 */
export function situationNow(plays = []) {
  const snap = lastLivePlay(plays);
  const words = lastActionPlay(plays);
  if (!words || words !== snap || halfEndedAfter(plays, words)) return null;
  const next = afterSnap(words);
  return next ? { ...next, offenseTeamId: snap.offenseTeamId ?? null } : null;
}
