// lib/mockNba/roster.js - the NBA mock draft's rosters (sun-5, sun-6, sun-7). PURE.
//
// PRESETS (Derik's rulings): STANDARD PG SG SF PF C G F UTIL UTIL UTIL + 3 BN
// (the default), TWO CENTERS PG SG G SF PF F C C UTIL UTIL + 3 BN, or CUSTOM -
// a count of 0-4 for each slot. One round per roster spot.
//
// ELIGIBILITY: a player's listed positions (`positions`, e.g. ['PG','SG'] or
// ['C','PF'] - from the ADP list, lib/mockNba/adp.js) when he has them; else the
// stats feed's coarse G / F / C (pairs like F-C are the union). PG and SG also
// play G; SF and PF play F; anyone plays UTIL or the bench.

export const SLOT_KEYS = Object.freeze(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'BN']);
export const SLOT_MAX = 4;

export const ROSTER_PRESETS = Object.freeze({
  standard: Object.freeze({ label: 'Standard', counts: Object.freeze({ PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 3, BN: 3 }) }),
  twoc: Object.freeze({ label: 'Two centers', counts: Object.freeze({ PG: 1, SG: 1, SF: 1, PF: 1, C: 2, G: 1, F: 1, UTIL: 2, BN: 3 }) }),
});

/** Slot counts -> the ordered slot list (starters in SLOT_KEYS order, bench last). */
export function slotsFromCounts(counts) {
  const out = [];
  for (const k of SLOT_KEYS) {
    const c = Math.max(0, Math.min(SLOT_MAX, Math.round(Number(counts?.[k]) || 0)));
    for (let i = 0; i < c; i += 1) out.push(k);
  }
  return out;
}

/** The default (standard) slots - 13. */
export const SLOTS = Object.freeze(slotsFromCounts(ROSTER_PRESETS.standard.counts));
export const ROUNDS = SLOTS.length;
export const TEAMS = 12;

const BY_POS = { PG: ['PG', 'G'], SG: ['SG', 'G'], SF: ['SF', 'F'], PF: ['PF', 'F'], C: ['C'] };
const BY_LETTER = { G: ['PG', 'SG', 'G'], F: ['SF', 'PF', 'F'], C: ['C'] };

const ELIG = new WeakMap(); // pool rows never change shape mid-draft: one Set per row

/**
 * The starting slots a player may fill (UTIL always). Accepts a player row
 * (uses `positions` first, then `pos`) or a bare position string.
 */
export function eligible(p) {
  if (p && typeof p === 'object') { const hit = ELIG.get(p); if (hit) return hit; }
  const out = new Set();
  const listed = typeof p === 'object' && Array.isArray(p?.positions) && p.positions.length ? p.positions : null;
  if (listed) {
    for (const x of listed) for (const s of BY_POS[String(x).toUpperCase()] ?? []) out.add(s);
  } else {
    const pos = typeof p === 'object' ? p?.pos : p;
    for (const l of String(pos ?? '').toUpperCase().split(/[-/, ]+/)) for (const s of BY_LETTER[l] ?? BY_POS[l] ?? []) out.add(s);
  }
  out.add('UTIL');
  if (p && typeof p === 'object') ELIG.set(p, out);
  return out;
}

/** The position label a row shows: its listed positions, else the feed's. */
export const posLabel = (p) => (Array.isArray(p?.positions) && p.positions.length ? p.positions.join(', ') : (p?.pos ?? ''));

/** A fresh roster for `slots`: one entry per slot, { slot, player }. */
export const emptyRoster = (slots = SLOTS) => slots.map((slot) => ({ slot, player: null }));

const SPECIFIC = ['PG', 'SG', 'SF', 'PF', 'C'];

/**
 * The slot a player would take: the first open STARTING slot he is eligible for,
 * most specific first (PG..C, then G/F, then UTIL), else a bench seat, else null.
 */
export function slotFor(roster, player) {
  const el = eligible(player);
  for (const order of [SPECIFIC, ['G', 'F'], ['UTIL']]) {
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

/** The roster a list of player ids makes, slotted in pick order (the share card). */
export function rosterFromIds(ids, pool, slots = SLOTS) {
  const byId = new Map((pool ?? []).map((p) => [Number(p.id), p]));
  let roster = emptyRoster(slots);
  for (const id of ids ?? []) {
    const p = byId.get(Number(id));
    if (p && slotFor(roster, p) != null) roster = place(roster, p);
  }
  return roster;
}

// SCARCITY (sun-7): the starting slot types a player family can fill. A G slot
// takes any PG or SG, an F slot any SF or PF, so the groups are checked whole too.
export const TYPES = Object.freeze(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F']);
const GROUPS = [['G', ['PG', 'SG', 'G']], ['F', ['SF', 'PF', 'F']]];
const LABEL = { PG: 'point guards', SG: 'shooting guards', SF: 'small forwards', PF: 'power forwards', C: 'centers', G: 'guards', F: 'forwards' };

/** Available players per slot type: { PG: n, ..., G: n, F: n }. */
export function supplyOf(players) {
  const out = Object.fromEntries(TYPES.map((t) => [t, 0]));
  for (const p of players ?? []) { const el = eligible(p); for (const t of TYPES) if (el.has(t)) out[t] += 1; }
  return out;
}
/** Open starting slots per type across rosters. */
export function demandOf(rosters) {
  const out = Object.fromEntries(TYPES.map((t) => [t, 0]));
  for (const r of rosters) for (const x of r) if (!x.player && x.slot in out) out[x.slot] += 1;
  return out;
}
/** The first slot type (or group) whose demand exceeds supply, or null. */
export function shortfall(supply, demand) {
  for (const t of ['C', 'PG', 'SG', 'SF', 'PF']) if (demand[t] > supply[t]) return { type: t, need: demand[t], have: supply[t] };
  for (const [g, members] of GROUPS) {
    const need = members.reduce((a, m) => a + demand[m], 0);
    if (need > supply[g]) return { type: g, need, have: supply[g] };
  }
  return null;
}

/**
 * CAN THIS ROSTER BE DRAFTED by `teams` teams from `pool`? { ok, message }.
 * Refuses: no slots; no starters; more picks than players (leaving a little
 * room); and any slot type (or the guard / forward group) the pool cannot cover
 * for every team. The draft itself keeps that last promise as it goes
 * (lib/mockNba/draft.js legalFor).
 */
export function checkFillable(pool, slots, teams) {
  if (!slots.length) return { ok: false, message: 'Add at least one roster spot.' };
  const starters = slots.filter((s) => s !== 'BN');
  if (!starters.length) return { ok: false, message: 'Add at least one starting spot (bench alone cannot be drafted).' };
  const picks = slots.length * teams;
  const room = (pool?.length ?? 0) - teams;
  if (picks > room) {
    const most = Math.max(0, Math.floor(room / teams));
    return { ok: false, message: `${teams} teams x ${slots.length} spots is ${picks} picks, more than the pool can supply. Use ${most} spots or fewer, or fewer teams.` };
  }
  const demand = demandOf(Array.from({ length: teams }, () => emptyRoster(slots)));
  const short = shortfall(supplyOf(pool), demand);
  if (short) return { ok: false, message: `Not enough ${LABEL[short.type]}: ${teams} teams need ${short.need} and the pool has ${short.have}. Lower that slot count or the number of teams.` };
  return { ok: true, message: null };
}
