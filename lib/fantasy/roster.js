// lib/fantasy/roster.js - lineup-order roster construction. PURE functions: data
// in, data out, no DB and no React, so the ordering rules are unit-testable the
// same way engine.js is (the room is a client component and cannot be imported
// by a node test).
//
// SLOT COUNTS ARE CONFIG-DRIVEN: they are read off the preset's roster_slots
// jsonb row (presets are draft_configs ROWS, not code). Only the ORDER lives
// here, because jsonb key order is an artifact of how the row was written - the
// shipped presets store K before DST - and is not a product decision. A slot the
// config carries that STARTER_ORDER does not name still renders, so a future
// preset slot can never silently vanish from the roster.

export const STARTER_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'DST', 'K'];
export const BENCH = 'BN';

/**
 * Expand a roster_slots config into ordered, labelled slots.
 * Numbered only where the config gives more than one (RB1/RB2, but a lone TE),
 * so a 2QB preset reads QB1/QB2 without hardcoding.
 * @param {Record<string, number>} rosterSlots  e.g. {"QB":1,"RB":2,...,"BN":6}
 * @returns {Array<{key: string, label: string, pick: null}>}
 */
export function orderedSlots(rosterSlots) {
  const out = [];
  const push = (key) => {
    const n = rosterSlots[key] ?? 0;
    for (let i = 0; i < n; i++) {
      out.push({ key, label: key === BENCH ? `BN${i + 1}` : (n > 1 ? `${key}${i + 1}` : key), pick: null });
    }
  };
  for (const key of STARTER_ORDER) push(key);
  for (const key of Object.keys(rosterSlots)) {
    if (!STARTER_ORDER.includes(key) && key !== BENCH) push(key);
  }
  push(BENCH); // bench always last
  return out;
}

/**
 * Place the user's picks into ordered slots. A drafted player fills the first
 * eligible OPEN slot; overflow goes to bench. The pick's rosterSlot is server
 * truth (the engine assigned it), so this only renders what the engine decided.
 */
export function buildRoster(userPicks, rosterSlots, kept = []) {
  const slots = orderedSlots(rosterSlots);
  for (const pk of [...userPicks].sort((a, b) => a.overallPick - b.overallPick)) {
    const s = slots.find((x) => x.key === pk.rosterSlot && !x.pick)
      || slots.find((x) => x.key === BENCH && !x.pick);
    if (s) s.pick = pk;
  }
  // KEPT PLAYERS NOT YET COMMITTED render in their slots now. A keeper is the
  // user's from before pick one; the engine has simply not reached his overall.
  // He has no engine-assigned rosterSlot yet, so placement is by position -
  // first open slot of his position, then FLEX if he is FLEX-eligible, then
  // bench - and is provisional: when the commit lands he arrives as a pick
  // with the engine's slot and the kept entry for that overall is gone. A
  // slot carrying a kept entry stays `pick: null`; readers that count picks
  // count picks.
  for (const k of [...kept].sort((a, b) => a.overall - b.overall)) {
    const pos = k.slotPos ?? k.position;
    const open = (key) => slots.find((x) => x.key === key && !x.pick && !x.kept);
    const s = open(pos) || (FLEX_ELIGIBLE.has(pos) ? open('FLEX') : null) || open(BENCH);
    if (s) s.kept = k;
  }
  return slots;
}

// Mirrors engine.js FLEX_ELIGIBLE; the roster cannot import the engine (it is
// the client's), so the three positions are restated here.
const FLEX_ELIGIBLE = new Set(['RB', 'WR', 'TE']);
