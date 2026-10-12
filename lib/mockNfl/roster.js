// lib/mockNfl/roster.js - the NFL mock draft's rosters: the ROSTER KIT the shared
// engine (lib/mockNba/draft.js) drafts with (mon-3). PURE. Same exports as
// lib/mockNba/roster.js.
//
// PRESETS (Derik's rulings): ESPN standard roster QB, 2 RB, 2 WR, TE, FLEX, D/ST,
// K + 7 bench (the default), Yahoo standard roster QB, 2 RB, 3 WR, TE, W/R/T, K,
// DEF + 6 bench, or CUSTOM - a count per slot. W/R/T is FLEX and DEF is D/ST by
// another name: one slot each here.
//
// ELIGIBILITY: a player's one position (QB, RB, WR, TE, K, DST); RB, WR and TE
// also play FLEX; QB, RB, WR and TE play SFLX (superflex, tue-0); anyone sits on
// the bench.
//
// MORE PRESETS (tue-0, parity with the old /sim setup): "2QB / Superflex" (a
// superflex slot beside the standard roster) and "The Draft (8 rounds)" - the
// weekly Draft's own eight (lib/draft/contest.js DRAFT_CONFIG: QB, 2 RB, 3 WR,
// TE, FLEX; no bench, kicker or defense).

export const SLOT_KEYS = Object.freeze(['QB', 'RB', 'WR', 'TE', 'FLEX', 'SFLX', 'K', 'DST', 'BN']);
export const SLOT_MAX = 4;
export const BENCH_MAX = 10;
export const SLOT_LABEL = Object.freeze({ QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLEX', SFLX: 'SFLX', K: 'K', DST: 'D/ST', BN: 'BN' });

export const ROSTER_PRESETS = Object.freeze({
  espn: Object.freeze({ label: 'ESPN standard roster', counts: Object.freeze({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 7 }) }),
  yahoo: Object.freeze({ label: 'Yahoo standard roster', counts: Object.freeze({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 }) }),
  superflex: Object.freeze({ label: '2QB / Superflex', counts: Object.freeze({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SFLX: 1, K: 1, DST: 1, BN: 6 }) }),
  thedraft: Object.freeze({ label: 'The Draft (8 rounds)', counts: Object.freeze({ QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1 }) }),
});

const cap = (k) => (k === 'BN' ? BENCH_MAX : SLOT_MAX);

/** Slot counts -> the ordered slot list (starters in SLOT_KEYS order, bench last). */
export function slotsFromCounts(counts) {
  const out = [];
  for (const k of SLOT_KEYS) {
    const c = Math.max(0, Math.min(cap(k), Math.round(Number(counts?.[k]) || 0)));
    for (let i = 0; i < c; i += 1) out.push(k);
  }
  return out;
}

export const SLOTS = Object.freeze(slotsFromCounts(ROSTER_PRESETS.espn.counts));
export const ROUNDS = SLOTS.length;
export const TEAMS = 12;

const FLEXABLE = new Set(['RB', 'WR', 'TE']);
const ELIG = new WeakMap();

/** The starting slots a player may fill. A row ({ pos }) or a bare position. */
export function eligible(p) {
  if (p && typeof p === 'object') { const hit = ELIG.get(p); if (hit) return hit; }
  const pos = String((typeof p === 'object' ? p?.pos : p) ?? '').toUpperCase();
  const out = new Set();
  if (['QB', 'RB', 'WR', 'TE', 'K', 'DST'].includes(pos)) out.add(pos);
  if (FLEXABLE.has(pos)) out.add('FLEX');
  if (pos === 'QB' || FLEXABLE.has(pos)) out.add('SFLX');
  if (p && typeof p === 'object') ELIG.set(p, out);
  return out;
}

export const posLabel = (p) => SLOT_LABEL[p?.pos] ?? p?.pos ?? '';

export const emptyRoster = (slots = SLOTS) => slots.map((slot) => ({ slot, player: null }));

/** The slot a player would take: his position's open slot, else FLEX, else the bench, else null. */
export function slotFor(roster, player) {
  const el = eligible(player);
  for (const order of [['QB', 'RB', 'WR', 'TE', 'K', 'DST'], ['FLEX'], ['SFLX']]) {
    const i = roster.findIndex((r) => !r.player && order.includes(r.slot) && el.has(r.slot));
    if (i !== -1) return i;
  }
  const b = roster.findIndex((r) => !r.player && r.slot === 'BN');
  return b === -1 ? null : b;
}

export function place(roster, player) {
  const i = slotFor(roster, player);
  if (i == null) throw new Error(`roster full: cannot place ${player.name}`);
  return roster.map((r, k) => (k === i ? { ...r, player } : r));
}

export const openStarters = (roster) => roster.filter((r) => !r.player && r.slot !== 'BN').map((r) => r.slot);

export function fillsStarter(roster, player) {
  const i = slotFor(roster, player);
  return i != null && roster[i].slot !== 'BN';
}

export function rosterFromIds(ids, pool, slots = SLOTS) {
  const byId = new Map((pool ?? []).map((p) => [String(p.id), p]));
  let roster = emptyRoster(slots);
  for (const id of ids ?? []) {
    const p = byId.get(String(id));
    if (p && slotFor(roster, p) != null) roster = place(roster, p);
  }
  return roster;
}

// SCARCITY: per position, FLEX as a group (any RB, WR or TE), and SFLX as a
// wider one (any QB, RB, WR or TE).
export const TYPES = Object.freeze(['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'FLEX', 'SFLX']);
const LABEL = { QB: 'quarterbacks', RB: 'running backs', WR: 'wide receivers', TE: 'tight ends', K: 'kickers', DST: 'defenses', FLEX: 'running backs, receivers and tight ends', SFLX: 'quarterbacks, running backs, receivers and tight ends' };

export function supplyOf(players) {
  const out = Object.fromEntries(TYPES.map((t) => [t, 0]));
  for (const p of players ?? []) { const el = eligible(p); for (const t of TYPES) if (el.has(t)) out[t] += 1; }
  return out;
}
export function demandOf(rosters) {
  const out = Object.fromEntries(TYPES.map((t) => [t, 0]));
  for (const r of rosters) for (const x of r) if (!x.player && x.slot in out) out[x.slot] += 1;
  return out;
}
export function shortfall(supply, demand) {
  for (const t of ['QB', 'K', 'DST', 'TE', 'RB', 'WR']) if (demand[t] > supply[t]) return { type: t, need: demand[t], have: supply[t] };
  const need = demand.RB + demand.WR + demand.TE + demand.FLEX;
  if (need > supply.FLEX) return { type: 'FLEX', need, have: supply.FLEX };
  const wide = need + demand.QB + demand.SFLX;
  if (wide > supply.SFLX) return { type: 'SFLX', need: wide, have: supply.SFLX };
  return null;
}

/** CAN THIS ROSTER BE DRAFTED by `teams` teams from `pool`? { ok, message }. */
export function checkFillable(pool, slots, teams) {
  if (!slots.length) return { ok: false, message: 'Add at least one roster spot.' };
  if (!slots.some((s) => s !== 'BN')) return { ok: false, message: 'Add at least one starting spot (bench alone cannot be drafted).' };
  const picks = slots.length * teams;
  const room = (pool?.length ?? 0) - teams;
  if (picks > room) {
    const most = Math.max(0, Math.floor(room / teams));
    return { ok: false, message: `${teams} teams x ${slots.length} spots is ${picks} picks, more than the pool can supply. Use ${most} spots or fewer, or fewer teams.` };
  }
  const short = shortfall(supplyOf(pool), demandOf(Array.from({ length: teams }, () => emptyRoster(slots))));
  if (short) return { ok: false, message: `Not enough ${LABEL[short.type]}: ${teams} teams need ${short.need} and the pool has ${short.have}. Lower that slot count or the number of teams.` };
  return { ok: true, message: null };
}
