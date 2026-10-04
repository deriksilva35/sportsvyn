// lib/draft/roomSeed.js - WHAT A BOT'S DICE ARE SEEDED BY. PURE.
//
// RULING D1 (sat-5): A RANKED ROOM IS SEEDED BY (CONTEST, SEAT, PICK NUMBER),
// NOT BY ITS OWN ID.
//
// The seat screen tells a reader that everyone at seat N starts from the same
// room. With the seed at `draftId * 7919 + overallPick` that was false: two
// readers at seat 4 who made identical picks faced different bots, because
// their rooms had different ids. Keyed on the contest and the seat instead,
// the engine's state before any bot pick is a function of the week's board
// (one per contest - lib/draft/frozenBoard.js contestBoardFor) and every pick
// made so far, and the dice are a function of (contest, seat, pick). Same
// seat + same human picks => the same room, by induction on the pick number.
// Different human picks change the state the bots see, so they react - which
// is the second half of the sentence the seat screen now says.
//
// THE SEAT IS IN THE KEY, deliberately. Without it every seat of a week would
// roll the same dice at the same overall pick, which is harmless but says
// something the product does not claim; with it, "same room" means exactly
// "same seat".
//
// PRACTICE ROOMS KEEP THEIR OWN SEEDING. A mock has no contest, and nobody is
// promised that two mocks match - `ranked` null falls back to the old key so
// every practice room behaves exactly as it did.

/**
 * The integer seed for one bot pick.
 *
 * @param {object} a
 * @param {number} a.draftId          the room (practice fallback)
 * @param {number} a.overallPick      1-based
 * @param {{contestId:number}|null} a.ranked   the ranked window, or null
 * @param {number} [a.seat]           the HUMAN's seat (pick_position), 1-based
 * @returns {number} a uint32
 */
export function botSeed({ draftId, overallPick, ranked = null, seat = null }) {
  if (ranked?.contestId != null && seat != null) {
    // A 32-bit mix of three small integers. Math.imul keeps every step in
    // int32; the final >>> 0 is what mulberry32 (engine.makeRng) wants.
    let h = Math.imul(Number(ranked.contestId) | 0, 0x9E3779B1);
    h = (h ^ Math.imul(Number(seat) | 0, 0x85EBCA77)) | 0;
    h = (h ^ Math.imul(Number(overallPick) | 0, 0xC2B2AE3D)) | 0;
    h ^= h >>> 16;
    return h >>> 0;
  }
  return (Number(draftId) * 7919 + Number(overallPick)) >>> 0;
}
