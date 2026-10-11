// lib/mockNba/roster.js - the NBA mock draft's roster: 13 rounds into
// PG SG SF PF C G F UTIL UTIL UTIL + 3 BN - ESPN's standard (sun-6 ruling). PURE.
//
// ELIGIBILITY FROM BDL'S POSITIONS. BDL lists only G, F, C and pairs of them
// (G-F, F-C, ...) - it does not split guards into PG/SG or forwards into SF/PF -
// so a G may play PG, SG or G; an F SF, PF or F; a C only C; a pair is the union;
// anyone plays UTIL or BN. That is coarser than a real league's eligibility and
// the page says positions are BDL's.

export const SLOTS = Object.freeze(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL', 'BN', 'BN', 'BN']);
export const STARTERS = SLOTS.filter((s) => s !== 'BN');
export const ROUNDS = SLOTS.length; // 13
export const TEAMS = 12;

const BY_LETTER = { G: ['PG', 'SG', 'G'], F: ['SF', 'PF', 'F'], C: ['C'] };

/** The starting slots a BDL position string may fill (UTIL always). */
export function eligible(pos) {
  const out = new Set();
  for (const l of String(pos ?? '').toUpperCase().split(/[-/ ]+/)) for (const s of BY_LETTER[l] ?? []) out.add(s);
  out.add('UTIL');
  return out;
}

/** A fresh roster: one entry per slot, { slot, player }. */
export const emptyRoster = () => SLOTS.map((slot) => ({ slot, player: null }));

/**
 * The slot a player would take: the first open STARTING slot he is eligible for,
 * most specific first (PG..C, then G/F, then UTIL), else a bench seat, else null.
 */
export function slotFor(roster, player) {
  const el = eligible(player.pos);
  for (const order of [['PG', 'SG', 'SF', 'PF', 'C'], ['G', 'F'], ['UTIL']]) {
    const i = roster.findIndex((r) => !r.player && order.includes(r.slot) && el.has(r.slot));
    if (i !== -1) return i;
  }
  const b = roster.findIndex((r) => !r.player && r.slot === 'BN');
  return b === -1 ? null : b;
}

/** Place a player (returns a NEW roster) or throw - a full roster takes nobody. */
export function place(roster, player) {
  const i = slotFor(roster, player);
  if (i == null) throw new Error(`roster full: cannot place ${player.name}`);
  return roster.map((r, k) => (k === i ? { ...r, player } : r));
}

/** Empty starting slots. */
export const openStarters = (roster) => roster.filter((r) => !r.player && r.slot !== 'BN').map((r) => r.slot);

/** Would this player fill an empty STARTING slot? */
export function fillsStarter(roster, player) {
  const i = slotFor(roster, player);
  return i != null && roster[i].slot !== 'BN';
}

/** The roster a list of player ids makes, slotted in pick order (the share card). PURE. */
export function rosterFromIds(ids, pool) {
  const byId = new Map((pool ?? []).map((p) => [Number(p.id), p]));
  let roster = emptyRoster();
  for (const id of ids ?? []) {
    const p = byId.get(Number(id));
    if (p && slotFor(roster, p) != null) roster = place(roster, p);
  }
  return roster;
}
