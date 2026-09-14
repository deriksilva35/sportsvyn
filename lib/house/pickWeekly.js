// lib/house/pickWeekly.js - the house's Weekly lineup. PURE.
//
// THERE IS NO PROJECTION IN THIS PRODUCT (ruling R3, and measured: a board row
// is {id, pos, name, team, resume} and the resume is a display string whose
// first field is career PPG). So the house ranks on CAREER PPG and every
// method line says "career PPG" rather than "projection", because saying
// projection would be the method line lying about the method.
//
// WHEN THE PROJECTION RELAY LANDS this module changes in one place - the
// `rank` function below - and the method strings in personas.js change with
// it. Nothing else here knows where the number came from.
//
// THE PARSE IS NOT OURS. ppgOf lives in lib/weekly/view.js because the room's
// own pool sorting already needed it; a second parser for the same string
// would be a second answer to "how good is this player".

import { SLOTS, slotAccepts } from '../weekly/rules.js';
import { ppgOf } from '../weekly/view.js';
import { HOMER_TEAMS } from './personas.js';

/** Board rows legal for this slot and not already used, best PPG first. */
function candidates(board, slot, usedIds) {
  return (board ?? [])
    .filter((p) => !usedIds.has(p.id))
    .filter((p) => slotAccepts(slot, p.pos))
    .map((p) => ({ p, ppg: ppgOf(p.resume) }))
    .sort((a, b) => b.ppg - a.ppg || String(a.p.name).localeCompare(String(b.p.name)));
}

/** THE CHALK. Highest career PPG at every slot. */
export function chalkWeekly(board) {
  const used = new Set();
  const lineup = {};
  for (const slot of SLOTS) {
    const [best] = candidates(board, slot, used);
    if (!best) continue;              // an unfillable slot stays empty, honestly
    lineup[slot] = best.p.id;
    used.add(best.p.id);
  }
  return lineup;
}

/** THE GUT. Weighted random over the top eight at each slot. */
export function gutWeekly(board, rng) {
  const used = new Set();
  const lineup = {};
  for (const slot of SLOTS) {
    const tier = candidates(board, slot, used).slice(0, 8);
    if (!tier.length) continue;
    const total = tier.reduce((a, c) => a + Math.max(0.1, c.ppg), 0);
    let draw = rng() * total;
    let chosen = tier[tier.length - 1];
    for (const c of tier) { draw -= Math.max(0.1, c.ppg); if (draw <= 0) { chosen = c; break; } }
    lineup[slot] = chosen.p.id;
    used.add(chosen.p.id);
  }
  return lineup;
}

/**
 * THE HOMER. Its own teams first, the chalk to fill the rest.
 *
 * WITH NONE OF ITS TEAMS ELIGIBLE FOR A SLOT this is the chalk at that slot,
 * and with none anywhere it is the chalk entire - which is a real outcome, not
 * a failure, and the method line already told the reader it would be.
 */
export function homerWeekly(board, teams = HOMER_TEAMS) {
  const mine = new Set(teams);
  const used = new Set();
  const lineup = {};
  for (const slot of SLOTS) {
    const cands = candidates(board, slot, used);
    const own = cands.find((c) => mine.has(c.p.team));
    const chosen = own ?? cands[0];
    if (!chosen) continue;
    lineup[slot] = chosen.p.id;
    used.add(chosen.p.id);
  }
  return lineup;
}

/** How many slots came from a Homer team - for the report, and for a test. */
export function homerOwnSlots(lineup, board, teams = HOMER_TEAMS) {
  const mine = new Set(teams);
  const byId = new Map((board ?? []).map((p) => [p.id, p]));
  return Object.values(lineup ?? {}).filter((id) => mine.has(byId.get(id)?.team)).length;
}

export function pickWeekly(personaKey, board, rng) {
  switch (personaKey) {
    case 'chalk': return chalkWeekly(board);
    case 'gut': return gutWeekly(board, rng);
    case 'homer': return homerWeekly(board);
    // The Fade has no line to fade on a player board (ruling R1).
    default: return null;
  }
}
