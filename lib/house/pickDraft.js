// lib/house/pickDraft.js - THE HOUSE'S SEAT, and only the house's seat. PURE.
//
// THE ENGINE EVERY PLAYER USES IS NOT TOUCHED (ruling R4). Each persona runs
// its OWN room against the same eleven bots everybody else drafts against;
// the only thing that changes is what the twelfth seat - the one the house
// occupies - does on its turn. lib/fantasy/engine.js aiPick is untouched, so
// no player's room behaves differently than it did yesterday.
//
// THE HOOK IS A FUNCTION, NOT A FLAG. autoCompleteDraftFor takes an optional
// seatStrategy and defaults to engine.autoPick, which is exactly what it did
// before - so the sim, the tracker and every existing caller keep the
// behaviour they had, and a persona is simply a different function passed in.
//
// EVERY STRATEGY BELOW RETURNS A PLAYER FROM legalCandidates, never a raw pool
// row. The candidate list is where the roster rules live - starter slots, the
// K/DST guardrails, the bye stacking - and a strategy that picked around it
// would be a strategy that drafts an illegal roster.

import { HOMER_TEAMS } from './personas.js';

/**
 * THE CHALK: best available, every pick. This IS engine.autoPick's behaviour -
 * the candidate list arrives ADP-sorted - and it is named here so the persona
 * reads as a decision rather than as the default nobody chose.
 */
export function chalkSeat(cands) {
  return cands[0] ?? null;
}

/**
 * THE FADE: the player the room is SLIDING, not the one it is reaching for.
 *
 * A slide is a player whose ADP is well ahead of where the board now sits -
 * he was supposed to be gone and is not. Taking the biggest slide in the top
 * of the list is the draft-room version of taking the dog: it is the pick the
 * room has collectively decided against.
 *
 * WITHIN THE TOP TWELVE ONLY. A slide forty picks deep is not a slide, it is
 * a worse player, and a persona that dressed that up as contrarian would just
 * be losing on purpose.
 */
export function fadeSeat(cands, overallPick) {
  const tier = cands.slice(0, 12);
  if (!tier.length) return null;
  let best = tier[0];
  let bestSlide = Number(tier[0].adp) - overallPick;
  for (const c of tier) {
    const slide = Number(c.adp) - overallPick;
    if (slide > bestSlide) { best = c; bestSlide = slide; }
  }
  return best;
}

/** THE GUT: weighted random over the top tier, by inverse ADP. */
export function gutSeat(cands, rng) {
  const tier = cands.slice(0, 8);
  if (!tier.length) return null;
  const w = tier.map((c) => 1 / Math.max(1, Number(c.adp)));
  const total = w.reduce((a, x) => a + x, 0);
  let draw = rng() * total;
  for (let i = 0; i < tier.length; i += 1) {
    draw -= w[i];
    if (draw <= 0) return tier[i];
  }
  return tier[tier.length - 1];
}

/**
 * THE HOMER: its own teams first, best available to fill the rest.
 *
 * A ROSTER OF EIGHT CANNOT BE ALL HOMER TEAMS and is not meant to be - four
 * clubs do not field eight startable players a draft will leave available.
 * The rule is a preference, not a requirement, and the fallback is the chalk.
 */
export function homerSeat(cands, teams = HOMER_TEAMS) {
  const mine = new Set(teams);
  return cands.find((c) => mine.has(c.team)) ?? cands[0] ?? null;
}

/**
 * The seat strategy for one persona, in the shape autoCompleteDraftFor wants:
 *   (candidates, { overallPick, rng }) -> player | null
 */
export function seatStrategyFor(personaKey) {
  switch (personaKey) {
    case 'chalk': return (cands) => chalkSeat(cands);
    case 'fade': return (cands, { overallPick }) => fadeSeat(cands, overallPick);
    case 'gut': return (cands, { rng }) => gutSeat(cands, rng);
    case 'homer': return (cands) => homerSeat(cands);
    default: return null;
  }
}
