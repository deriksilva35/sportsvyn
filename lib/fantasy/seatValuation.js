// lib/fantasy/seatValuation.js — the "My Team" sort's valuation.
//
// Two governing sentences, in order of authority:
//   1. The sort never contradicts what the room accepts.
//   2. Inform, never prohibit.
// If a player is legal to draft, the sort may rank him anywhere - including
// last - but may never hide, filter, or disable him. Demotion is ranking;
// removal is prohibition.
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

// One starting slot, no flex path, replaceable off waivers most weeks. The pool
// vocabulary maps PK->K and DEF->DST, so both spellings are covered.
const STREAMABLE = new Set(['K', 'DST']);
const slotPosOf = (position) => ({ PK: 'K', DEF: 'DST' }[position] ?? position);
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
  // The horizon: one full round past BOARD PAR. Null when the room cannot say
  // where we are, in which case nothing is deferred - an unknown must not
  // silently demote a position.
  //
  // Board par, not the raw pick number - the same rule the engine adopted in
  // f4dadb6. On a keeper-drained board the pick number runs well behind the
  // market: draft 443 at pick 50 had the board's #1 available at ADP 73.1, so a
  // horizon read off the pick number (62) sat below the best available player
  // at EVERY position, every open slot deferred at once, and the one bucket that
  // could not defer - flex - owned the whole list: 65 tight ends, then the rest.
  // Par is where the market actually is; a position's turn is measured from
  // there.
  const boardTop = bestAdp.size ? Math.min(...bestAdp.values()) : null;
  const horizon = (currentOverall != null && teamsCount != null)
    ? Math.max(Number(currentOverall), boardTop ?? -Infinity) + Number(teamsCount)
    : null;

  const out = new Map();
  for (const p of rows) {
    const slot = slotStateFor(team, p.position);
    const best = bestAdp.get(p.position);
    // Open and flex defer by the SAME test. The market does not care which slot
    // a player would fill; exempting flex is what handed one position the list.
    const deferred = (slot === 'open' || slot === 'flex')
      && horizon != null && best != null && best > horizon;
    // A bench-only kicker or defense - their own slot is already filled. Kept
    // separate from the tag, which still reads honestly as 'DST · bench'; only
    // the RANK changes, and the row renders muted like a deferred one.
    const streamer = slot === 'bench' && STREAMABLE.has(slotPosOf(p.position));
    out.set(p.ffcPlayerId, {
      gap: valueGap(myNextOverall, p.adp),
      slot,
      streamer,
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
//   0  PLAYABLE NOW   - somewhere on this roster can take him TODAY: a dedicated
//                       slot open and in season, FLEX-eligible with FLEX open,
//                       or simply an open bench spot. Ordered by raw gap.
//   1  open or flex, DEFERRED - a startable slot the market says can wait
//   2  full           - nowhere left at all
//
// BENCH COUNTS. Rounds 6 to 15 are mostly bench, and a seat with six empty bench
// spots can take the best player on the board. Treating that as 'full' buried
// the best available value (a +5 receiver) beneath worse picks whose dedicated
// slot happened to be open (a -11 tight end). Benches are what those rounds are
// FOR. The consequence is that the playable tier becomes most of the board in
// the middle rounds, ordered by value - which is the correct board.
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
// THE MARKET TELLS YOU WHEN A POSITION'S TURN HAS COME. A position's open or
// flex slot is DEFERRED while the best available player at that position is
// still more than a full round away from where the market is:
//
//     bestAdpAtPosition > max(currentOverallPick, boardTopAdp) + teamsCount
//
// One round is the unit because that is the distance you can actually wait -
// come back next turn and the same player is plausibly still there. The rule is
// a principle, not a tuned table: it needs no per-position constants, expires by
// itself as the draft advances toward those ADPs, and generalises to any format
// or roster shape because it reads the pool rather than a calendar.
//
// Two amendments from draft 443 (2 Sep 2026), where the rule read the pick
// number and exempted flex, and the top 65 rows were tight ends:
//   - the anchor is board par, max(pick, board #1 ADP), not the pick number. On
//     a keeper board the pick number is not where the market is (see the
//     horizon note in computeSeatValuation).
//   - flex defers by the same test as open. A tight end at 79.9 is not "playable
//     now" while a running back at 73.1 for an open slot "can wait"; whichever
//     slot he would fill, his turn is the market's to call.
//
// The engine's own K/DST floors (no kicker before round 13) encode the same
// intuition, and are deliberately NOT imported: a hardcoded round is exactly the
// hand-tuned constant this avoids, and it would say nothing about a TE or a QB2.
// capped ranks ABSOLUTE LAST - below even 'full' - per the K/DST-cap law:
// "excluded from the ranked list" rendered in this module's own grammar,
// where demotion is ranking and removal would be prohibition (law 1 of the
// header). The streamer read IS the capped state: a K/DST whose startable
// slots are exhausted, at whatever cap the room's roster shape sets.
const RANK = { playable: 0, deferred: 1, streamerBench: 2, full: 3, capped: 4 };

/**
 * Rank for one read. Unknown states sort last, never as playable.
 *
 * Takes the READ rather than the tag: 'open' or 'flex' alone does not place a
 * row, because deferral is what separates a slot whose turn has come from one
 * that can wait. An undeferred open slot and an undeferred FLEX are the SAME
 * rank - both are startable this week, so they settle it on gap rather than on
 * category.
 */
export function slotRank(read) {
  if (!read) return 9;
  if (read.slot === 'open') return read.deferred ? RANK.deferred : RANK.playable;
  // STREAMABLE POSITIONS RANK BEHIND SKILL DEPTH ON THE BENCH. A kicker or
  // defense whose own slot is already filled can still go on the bench, and the
  // row stays draftable - it just stops leading a board almost nobody wants it
  // to lead. Reported from round 10: with Denver already rostered, a SECOND
  // defense at +17.3 was the top recommendation, above a +12.5 tight end for an
  // OPEN tight end slot.
  //
  // This is structural, not a tuned weight: one starting slot, no flex path,
  // waiver-replaceable week to week. It applies to K and DST and to nothing
  // else - a third running back benches fine, which is what benches are for.
  if (read.slot === 'bench') return read.streamer ? RANK.capped : RANK.playable;
  if (read.slot === 'flex') return read.deferred ? RANK.deferred : RANK.playable;
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
