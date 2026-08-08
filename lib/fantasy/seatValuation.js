// lib/fantasy/seatValuation.js — the "My Team" sort's valuation.
//
// THERE IS NO COMPOSITE SCORE. This module reads TWO FACTS per player and stops:
// the market gap at the seat's next pick, and how the seat's roster can absorb
// that position. The sort key is those two facts in sequence - slot bucket, then
// gap - so the order the reader sees IS the information the reader is shown.
// Nothing is multiplied, and nothing is invented on their behalf.
//
// WHY NOT gap x needWeight, which is what the engine does. Measured on the live
// ppr/12 pool at pick 52: 193 of 206 available players had a NEGATIVE gap, and
// multiplying a negative by a need multiplier > 1 pushes needed positions DOWN.
// Median composite was -138.7 for 'open' against -123.5 for 'flex' - the sort
// buried the positions the seat still needed, across 94% of the board.
//
// That is not a bug in needWeight. aiPick only ever scores legalCandidates - the
// top 15 by ADP, legal at the CURRENT pick - where the gap is near zero or
// positive and the product behaves. Applying the same product to the whole
// remaining board at a FUTURE pick is a different domain, and it inverts.
//
// So needWeight is NOT called here, and no number is produced for ordering. The
// engine linkage that matters is the one the reader can see: the slot bucket
// comes from slotStateFor, which reads the engine's own openDed/openFlex, so the
// tag and the ordering can never disagree with the roster arithmetic canRoster
// uses. A score that nothing orders or displays would be a loaded gun for
// whoever wired it back up.

import { seatTeamFromPicks, slotStateFor } from './engine.js';
import { valueGap } from './needs.js';

/**
 * Read every available player against ONE seat's roster.
 *
 * Returns Map<ffcPlayerId, { gap, slot }> - both DISPLAYED, both part of the
 * sort key, nothing else:
 *   gap  - market gap at the seat's next pick (myNextOverall - adp), or null
 *          when the seat has no pick left and the question has no answer.
 *   slot - 'open' | 'flex' | 'full' for that player's position right now.
 *
 * A null gap sorts last rather than as a zero, the same rule the movement board
 * uses: a missing number is not a small one.
 */
export function computeSeatValuation({
  rosterSlots, rounds, allPicks, seatPicks, available, myNextOverall,
  currentOverall = null, teamsCount = null,
}) {
  const team = seatTeamFromPicks(rosterSlots, seatPicks);
  const rows = available ?? [];

  // Best available ADP per position - the market signal the deferral reads.
  // Keyed on the RAW pool position, which is safe because the pool vocabulary
  // maps one-to-one onto slot vocabulary (PK->K, DEF->DST); no two raw
  // positions collapse into the same slot.
  const bestAdp = new Map();
  for (const p of rows) {
    const a = Number(p.adp);
    if (!Number.isFinite(a)) continue;
    const cur = bestAdp.get(p.position);
    if (cur == null || a < cur) bestAdp.set(p.position, a);
  }
  // The horizon: one full round past the pick being made. Null when the room
  // cannot say where we are, in which case nothing is deferred - an unknown
  // must not silently demote a position.
  const horizon = (currentOverall != null && teamsCount != null)
    ? Number(currentOverall) + Number(teamsCount)
    : null;

  const out = new Map();
  for (const p of rows) {
    const slot = slotStateFor(team, p.position);
    const best = bestAdp.get(p.position);
    const deferred = slot === 'open' && horizon != null && best != null && best > horizon;
    out.set(p.ffcPlayerId, {
      gap: valueGap(myNextOverall, p.adp),
      slot,
      // Display and ordering both read this. A deferred row keeps its 'open'
      // tag - the slot IS open - but renders muted, so the order stays
      // self-explaining rather than looking like a bug.
      deferred,
    });
  }
  return out;
}

// ============================ THE BUCKET ORDER ==============================
//
//   0  PLAYABLE NOW   - a dedicated slot is open and its turn has come, OR he is
//                       FLEX-eligible and FLEX is open. Ordered by raw gap.
//   1  open, DEFERRED - a startable slot the market says can wait
//   2  full           - bench depth only
//
// IF YOU CAN START HIM THIS WEEK, HE COMPETES ON VALUE.
//
// Open-dedicated and flex-eligible used to be absolute tiers, and that was
// wrong whenever both were genuinely in play. Reported from round 6, pick 63,
// with QB and FLEX both open: the sort put FIVE QBs at -4 to -21 above every
// flex-eligible player, while an ADP sort showed Pollard at +1 and Montgomery
// at +0 sitting there. A -21 reach outranked a +1 value for no reason except
// that no gap was allowed to cross a bucket boundary.
//
// A QB slot standing open IS a real need. A +1 running back for the FLEX IS a
// real value. The tiering pretended the first always dominates the second. It
// does not, so they now share a bucket and settle it on gap.
//
// The need information is NOT lost - it moved to where it belongs. The row still
// shows which kind of playable it is ('QB · open' against 'RB · flex'), so the
// reader can see why each row qualifies while the ORDER answers the only
// question a sort can honestly answer: who is the better buy right now.
//
// WHY THE DEFERRED BUCKET STILL EXISTS. Without it, "a dedicated open slot outranks flex" is
// structurally correct and fantasy-wrong: in round 7 with DST and K still open,
// the sort served five defenses at the top of the board. The slot was genuinely
// open; it was just nowhere near its turn.
//
// THE MARKET TELLS YOU WHEN A POSITION'S TURN HAS COME. A position's open slot
// is DEFERRED while the best available player at that position is still more
// than a full round away from the pick you are making:
//
//     bestAdpAtPosition > currentOverallPick + teamsCount
//
// One round is the unit because that is the distance you can actually wait -
// come back next turn and the same player is plausibly still there. The rule is
// a principle, not a tuned table: it needs no per-position constants, expires by
// itself as the draft advances toward those ADPs, and generalises to any format
// or roster shape because it reads the pool rather than a calendar.
//
// The engine's own K/DST floors (no kicker before round 13) encode the same
// intuition, and are deliberately NOT imported: a hardcoded round is exactly the
// hand-tuned constant this avoids, and it would say nothing about a TE or a QB2.
const RANK = { playable: 0, openDeferred: 1, full: 2 };

/**
 * Rank for one read. Unknown states sort last, never as playable.
 *
 * Takes the READ rather than the tag: 'open' alone does not place a row, because
 * deferral is what separates a slot whose turn has come from one that can wait.
 * An undeferred open slot and an open FLEX are the SAME rank - both are startable
 * this week, so they settle it on gap rather than on category.
 */
export function slotRank(read) {
  if (!read) return 9;
  if (read.slot === 'open') return read.deferred ? RANK.openDeferred : RANK.playable;
  if (read.slot === 'flex') return RANK.playable;
  if (read.slot === 'full') return RANK.full;
  return 9;
}

/** True when this row can go straight into a starting lineup this week. */
export function isPlayableNow(read) {
  return slotRank(read) === RANK.playable;
}

/** The per-player read, or null when this player was not valued. */
export function seatReadOf(valuation, player) {
  return valuation?.get(player?.ffcPlayerId) ?? null;
}

/**
 * THE COMPARATOR: slot bucket, then raw market gap descending inside it.
 *
 * A player with no read, or with a null gap, sorts after everyone who has one -
 * in both directions. Ties fall through to ADP so the order is total and stable.
 */
export function compareSeat(a, b, valuation) {
  const ra = seatReadOf(valuation, a);
  const rb = seatReadOf(valuation, b);
  if (!ra && !rb) return 0;
  if (!ra) return 1;
  if (!rb) return -1;

  const bucket = slotRank(ra) - slotRank(rb);
  if (bucket !== 0) return bucket;

  if (ra.gap == null && rb.gap == null) return 0;
  if (ra.gap == null) return 1;
  if (rb.gap == null) return -1;
  return rb.gap - ra.gap; // bigger gap first
}
