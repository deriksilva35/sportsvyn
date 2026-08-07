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
}) {
  const team = seatTeamFromPicks(rosterSlots, seatPicks);
  const out = new Map();
  for (const p of available ?? []) {
    out.set(p.ffcPlayerId, {
      gap: valueGap(myNextOverall, p.adp),
      slot: slotStateFor(team, p.position),
    });
  }
  return out;
}

// Bucket order: a position you can still start beats one you can only flex,
// which beats one that is only bench depth. This is the FIRST sort key, and it
// is exactly the tag the row displays - the reader can read the order off the
// screen without being told a score.
const SLOT_RANK = { open: 0, flex: 1, full: 2 };

/** Rank for the slot bucket; unknown reads last, never as 'open'. */
export function slotRank(slot) {
  return SLOT_RANK[slot] ?? 3;
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

  const bucket = slotRank(ra.slot) - slotRank(rb.slot);
  if (bucket !== 0) return bucket;

  if (ra.gap == null && rb.gap == null) return 0;
  if (ra.gap == null) return 1;
  if (rb.gap == null) return -1;
  return rb.gap - ra.gap; // bigger gap first
}
