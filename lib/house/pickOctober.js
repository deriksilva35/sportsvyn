// lib/house/pickOctober.js - the house's five-a-day card. PURE.
//
// THE EXISTING POLICIES, APPLIED TO A NEW GAME, not new policies invented for
// it. The Chalk takes the best number; The Gut takes a weighted random from
// the top tier; The Homer takes its own where today's games have them and the
// chalk elsewhere. The Fade has no row here at all - ruling R1: there is no
// line on an individual player, so it has nothing to be contrarian about, and
// an absent row says that where a faked one would say the opposite.
//
// IT PLAYS BY THE SAME RULES AS EVERYONE. lib/october/rules.js refuseReason()
// is the gate, called for every candidate, so the house cannot exceed the day's
// cap from one game, cannot put a player in two slots and cannot pick from a
// started game. A persona that got its own relaxed copy of the rules would not
// be playing the game the reader is playing.
//
// AND THAT INCLUDES THE BURN'S ABSENCE. October has no burn, so neither does the
// house: `ctx.used` is not read, because refuseReason no longer takes one. The
// Run's own house picker (lib/house/pickRun.js) still does.

import { SLOTS, refuseReason } from '../october/rules.js';
import { HOMER_TEAMS } from './personas.js';

/** Candidates for one slot: the right kind, and legal on this card right now. */
function candidates(lineup, slot, pool, ctx) {
  const kind = slot === 'arm' ? 'arm' : 'bat';
  return (pool ?? [])
    .filter((p) => p.kind === kind)
    .filter((p) => refuseReason(lineup, slot, p, ctx) == null)
    .sort((a, b) => (b.ppg ?? -Infinity) - (a.ppg ?? -Infinity) || String(a.name).localeCompare(String(b.name)));
}

/** Fill the five in slot order, re-deriving legality after every pick. */
function fill(pool, ctx, choose) {
  const lineup = {};
  // FIVE, ALWAYS. The cap scales with the slate so that five is always
  // reachable (lib/october/rules.js maxPerGame); the card never shrinks.
  for (const slot of SLOTS) {
    const c = candidates(lineup, slot, pool, ctx);
    if (!c.length) continue;          // no legal candidate is an empty slot, and a DNF
    const p = choose(c, slot);
    if (p) lineup[slot] = { playerId: String(p.playerId), matchId: Number(p.matchId), kind: p.kind, name: p.short ?? p.name };
  }
  return lineup;
}

/** THE CHALK. Highest PPG at every slot the day's cap allows. */
export function chalkOctober(pool, ctx) {
  return fill(pool, ctx, (c) => c[0]);
}

/**
 * THE GUT. Weighted random over the top tier - the same shape as its Daily
 * and Weekly method, so a reader who has watched it elsewhere knows what it
 * is doing here.
 */
export function gutOctober(pool, ctx, rng = Math.random) {
  return fill(pool, ctx, (c) => {
    const tier = c.slice(0, Math.max(1, Math.ceil(c.length / 3)));
    return tier[Math.floor(rng() * tier.length)] ?? tier[0];
  });
}

/**
 * THE HOMER. Its own where today's games have them, the chalk elsewhere.
 *
 * ITS TEAMS ARE FOOTBALL TEAMS. HOMER_TEAMS is a gridiron set, so most October
 * days it has nobody of its own and falls entirely to the chalk - which is the
 * honest reading of its rule for a sport its teams do not play in, and is
 * exactly what the method line now says.
 */
export function homerOctober(pool, ctx, teams = HOMER_TEAMS) {
  const own = new Set(teams);
  return fill(pool, ctx, (c) => c.find((p) => own.has(p.team)) ?? c[0]);
}

export const OCTOBER_PICKERS = Object.freeze({
  chalk: chalkOctober, gut: gutOctober, homer: homerOctober,
});

export function pickOctober(personaKey, pool, ctx, rng) {
  const f = OCTOBER_PICKERS[personaKey];
  if (!f) return null;
  return personaKey === 'gut' ? f(pool, ctx, rng) : f(pool, ctx);
}
