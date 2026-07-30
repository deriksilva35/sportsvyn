// lib/fantasy/needs.js — PURE needs/best-available math for the tracker's MY TEAM
// panel. No DB, no React, no AI: the observational line is ASSEMBLED, not written.
//
// SIGN CONVENTION (one, everywhere):
//     gap = pickNumber - adp
//   positive  the player has fallen PAST his ADP to that pick  -> value  (jade)
//   negative  taking him there is earlier than the market      -> reach  (dim)
// This matches grade.js's displayValue exactly, so the tracker's chips and the
// sim's grade never disagree about which direction is good.
//
// "An observation, not a verdict" is the register and it is load-bearing: this
// panel states what IS on the board (slots open, positions going), never what the
// user should do. No "take", no "target", no "you need".

import { PARAMS } from './engine.js';
import { BENCH } from './roster.js';

// Plural nouns for the observational line. Kept here rather than in the component
// so the register is testable.
const POS_NOUN = {
  QB: ['quarterback', 'quarterbacks'],
  RB: ['back', 'backs'],
  WR: ['receiver', 'receivers'],
  TE: ['tight end', 'tight ends'],
  K: ['kicker', 'kickers'],
  DST: ['defense', 'defenses'],
  FLEX: ['flex spot', 'flex spots'],
};
const noun = (pos, n) => (POS_NOUN[pos] ?? [pos, pos])[n === 1 ? 0 : 1];

export function valueGap(pickNumber, adp) {
  if (pickNumber == null || adp == null) return null;
  return Math.round((Number(pickNumber) - Number(adp)) * 10) / 10;
}

/**
 * Open STARTER slots by position, from buildRoster()'s output. Bench is excluded:
 * an open bench spot is not a need, it is just room.
 * @returns [{ pos, count }] ordered by count desc then position order encountered.
 */
export function openStarterSlotsByPos(rosterSlots) {
  const counts = new Map();
  for (const s of rosterSlots ?? []) {
    if (s.pick || s.key === BENCH) continue;
    counts.set(s.key, (counts.get(s.key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([pos, count]) => ({ pos, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Positional run in the recent picks, reusing the engine's OWN run thresholds so
 * "the room is running on RB" means the same thing to the tracker panel and to the
 * sim's AI. Returns { pos, count } for the strongest run, or null.
 */
export function detectRun(recentPicks, window = PARAMS.RUN_WINDOW, threshold = PARAMS.RUN_THRESHOLD) {
  const last = (recentPicks ?? []).slice(-window);
  const byPos = {};
  for (const p of last) {
    const pos = p.slotPos ?? p.position;
    if (!pos) continue;
    byPos[pos] = (byPos[pos] ?? 0) + 1;
  }
  let best = null;
  for (const [pos, count] of Object.entries(byPos)) {
    if (count >= threshold && (!best || count > best.count)) best = { pos, count };
  }
  return best;
}

/**
 * The one observational serif line. Deterministic, hyphens only, no advice.
 *
 * Three shapes, in priority order:
 *   1. a run is on AND it is a position you still have open  -> the squeeze
 *   2. you have open starter slots                            -> what is open
 *   3. starters are full                                      -> say so plainly
 */
export function needsObservation({ openSlots = [], recentPicks = [] } = {}) {
  const open = openSlots.filter((s) => s.count > 0);
  if (open.length === 0) {
    return { text: 'Every starting slot is filled. What is left is depth.', squeeze: null };
  }

  const top = open[0];
  const openPhrase = `${top.count === 1 ? 'One' : top.count} ${noun(top.pos, top.count)} ${top.count === 1 ? 'slot is' : 'slots are'} open`;

  const run = detectRun(recentPicks);
  const runOnOpenPos = run && open.some((s) => s.pos === run.pos);
  if (runOnOpenPos) {
    return {
      text: `${openPhrase} and the room has taken ${run.count} ${noun(run.pos, run.count)} in a round - ${run.pos} is the squeeze.`,
      squeeze: run.pos,
    };
  }

  const rest = open.slice(1);
  const also = rest.length
    ? `, with ${rest.map((s) => `${s.count} at ${s.pos}`).join(' and ')}`
    : '';
  return { text: `${openPhrase}${also}. The board has not run on it yet.`, squeeze: null };
}

/**
 * Best available measured at the user's NEXT pick, not at the current one.
 *
 * DETERMINISTIC GAP ONLY (v1): the number is `myNextOverall - adp` and nothing
 * else. No survival probability — the pool carries ADP stdev and it would be easy
 * to dress a guess up as a percentage, but "he lasts 62% of the time" is a claim
 * this product has not earned. `likelyGone` is the honest flag instead: it states
 * the market fact (his ADP is before your pick) without inventing a probability.
 */
export function bestAvailableAtMyPick(available, myNextOverall, limit = 3) {
  if (myNextOverall == null) return [];
  return (available ?? [])
    .slice()
    .sort((a, b) => Number(a.adp) - Number(b.adp))
    .slice(0, limit)
    .map((p) => ({
      ffcPlayerId: p.ffcPlayerId,
      name: p.name,
      position: p.position,
      team: p.team ?? null,
      adp: Number(p.adp),
      gap: valueGap(myNextOverall, p.adp),
      likelyGone: Number(p.adp) < myNextOverall,
    }));
}

// "3.07" — the round.pickInRound slot label a draft room speaks in.
export function slotLabel(overallPick, teamsCount) {
  if (overallPick == null || !teamsCount) return null;
  const round = Math.ceil(overallPick / teamsCount);
  const inRound = ((overallPick - 1) % teamsCount) + 1;
  return `${round}.${String(inRound).padStart(2, '0')}`;
}
