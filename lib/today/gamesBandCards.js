// lib/today/gamesBandCards.js - what the front page's four game cards SAY (tue-3).
// PURE: GamesBand draws, this decides, and every state has a test.
//
// THE DEFECT THIS REPLACED, "a date that was never true":
//   - Pick'em's lock line read lockLabel(nextKickoff). With every game on the
//     board kicked, nextKickoff is null and new Date(null) is the epoch - "locks
//     Wed Dec 31". It now says "all games kicked", as the lobby row does.
import { lockLabel } from '../pickem/read.js';

/**
 * "locks <next kickoff>" while one is ahead; "all games kicked" once none is -
 * the lobby row's own words for the same state (lib/games/read.js). NOT the
 * board's first kickoff: pickemCardData dropped firstKickoff on purpose (a fact
 * about the board's past, never about what a reader can still do -
 * lib/pickem/nextLockLine.test.mjs guards it), and this does not bring it back.
 */
export function pickemLockLine({ nextKickoff = null } = {}) {
  const l = lockLabel(nextKickoff);
  return l ? `locks ${l}` : 'all games kicked';
}
