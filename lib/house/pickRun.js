// lib/house/pickRun.js - the house's nine. PURE.
//
// THE EXISTING POLICIES, on a ninth of a bigger roster. The Chalk takes the
// best PPG, The Gut a weighted random from the top tier, The Homer its own
// where the round has them. THE FADE HAS NO ROW - ruling R1 again: there is
// no line on an individual player, so it has nothing to be contrarian about.
//
// IT PLAYS BY THE SAME RULES. refuseReason() gates every candidate, so no
// persona exceeds three from a club, picks a bye club in round 1, re-uses a
// burned player or picks from a club that has started.
//
// A SHORT LEAGUE IS WHAT IT IS FOR. The relay's own words - "house personas
// fill a short league" - so these three are the difference between a
// two-player league and a board worth looking at.

import { SLOTS, refuseReason } from '../run/rules.js';
import { HOMER_TEAMS } from './personas.js';

function candidates(lineup, slot, pool, ctx) {
  const kind = slot.startsWith('arm') ? 'arm' : 'bat';
  return (pool ?? [])
    .filter((p) => p.kind === kind)
    .filter((p) => refuseReason(lineup, slot, p, ctx) == null)
    .sort((a, b) => (b.ppg ?? -Infinity) - (a.ppg ?? -Infinity) || String(a.name).localeCompare(String(b.name)));
}

function fill(pool, ctx, choose) {
  const lineup = {};
  for (const slot of SLOTS) {
    const c = candidates(lineup, slot, pool, ctx);
    if (!c.length) continue;   // no legal candidate leaves the slot open, and a DNF
    const p = choose(c, slot);
    if (p) {
      lineup[slot] = {
        playerId: String(p.playerId), teamId: Number(p.teamId),
        kind: p.kind, name: p.short ?? p.name, team: p.team ?? null,
      };
    }
  }
  return lineup;
}

/** THE CHALK. Highest PPG at every slot, inside the burn and the club cap. */
export function chalkRun(pool, ctx) { return fill(pool, ctx, (c) => c[0]); }

/** THE GUT. Weighted random over the top tier - its shape on every game. */
export function gutRun(pool, ctx, rng = Math.random) {
  return fill(pool, ctx, (c) => {
    const tier = c.slice(0, Math.max(1, Math.ceil(c.length / 3)));
    return tier[Math.floor(rng() * tier.length)] ?? tier[0];
  });
}

/**
 * THE HOMER. Its own where the round has them, the chalk elsewhere.
 * HOMER_TEAMS is a gridiron set, so most Octobers it has nobody and is all
 * chalk - which is the honest reading of its rule in a sport its teams do not
 * play in, and what its method line already says.
 */
export function homerRun(pool, ctx, teams = HOMER_TEAMS) {
  const own = new Set(teams);
  return fill(pool, ctx, (c) => c.find((p) => own.has(p.team)) ?? c[0]);
}

export const RUN_PICKERS = Object.freeze({ chalk: chalkRun, gut: gutRun, homer: homerRun });

export function pickRun(personaKey, pool, ctx, rng) {
  const f = RUN_PICKERS[personaKey];
  if (!f) return null;
  return personaKey === 'gut' ? f(pool, ctx, rng) : f(pool, ctx);
}
