// lib/mockNba/draft.js - the NBA mock draft, run entirely as pure state (sun-5, sun-7).
//
// N TEAMS (8-14) x ONE ROUND PER ROSTER SPOT, SNAKE. The browser holds the state
// and calls these functions; nothing is stored server-side while drafting (a
// finished draft is recorded anonymously - lib/mockNba/record.js). The bots are
// seeded (seed, pick number), so a draft replays exactly from its seed and the
// user's picks.
//
// BOTS DRAFT BY ADP WITH ROSTER NEED (sun-7 addendum): the market's order is
// closer to how real drafts go. With the ADP source off (MOCK_ADP_SOURCE=off) or
// for a player with no ADP, the key is SVP. A bench player is worth less to a
// bot whose starting slots are still open.
//
// THE MUST-START RULE binds bots and the user alike: once a team's picks left
// equal its empty starting slots, only a player who fills one is legal.
//
// THE SCARCITY RULE (sun-7) keeps every team's starters fillable: a pick is legal
// only if, after it, the players left still cover every open starting slot in
// the league, by type (C, PG, ...) and by group (any guard, any forward). Without
// it a custom roster with two C slots stalled once other teams had parked the
// last centers on their benches.

import { TEAMS, SLOTS, TYPES, emptyRoster, place, openStarters, fillsStarter, slotFor, eligible, supplyOf, demandOf, shortfall } from './roster.js';

/** Seat index (0-based) on the clock at overall pick n (1-based). */
export function seatAt(n, teams = TEAMS) {
  const i = n - 1; const r = Math.floor(i / teams); const k = i % teams;
  return r % 2 === 0 ? k : teams - 1 - k;
}
export const roundOf = (n, teams = TEAMS) => Math.floor((n - 1) / teams) + 1;

// mulberry32
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A new mock. `pool` rows carry `svp` (and `adp` when the source is on).
 * `botKey` 'adp' | 'svp' - what the bots draft by.
 */
export function createMock(pool, { userSeat, seed, teams = TEAMS, slots = SLOTS, botKey = 'svp' }) {
  return {
    seed: seed >>> 0, userSeat, teams, slots: [...slots], botKey,
    pool, picks: [], taken: new Set(),
    rosters: Array.from({ length: teams }, () => emptyRoster(slots)),
  };
}

export const totalPicks = (st) => st.teams * st.slots.length;
export const nextPick = (st) => st.picks.length + 1;
export const isDone = (st) => st.picks.length >= totalPicks(st);
export const onClock = (st) => (isDone(st) ? null : seatAt(nextPick(st), st.teams));
export const available = (st) => st.pool.filter((p) => !st.taken.has(p.id));
const picksLeft = (roster) => roster.filter((r) => !r.player).length;

/** A row's draft key: ADP rank when it has one and bots use ADP, else after every ADP rank by SVP. */
export function keyOf(p, botKey) {
  if (botKey === 'adp') return p.adp != null ? Number(p.adp) : 100000 + (Number(p.svp) || 99999);
  return Number(p.svp) || 99999;
}

/** Who a seat MAY take now (the must-start and scarcity rules). Ordered by SVP. */
export function legalFor(st, seat) {
  const roster = st.rosters[seat];
  const need = openStarters(roster).length;
  const mustStart = need > 0 && picksLeft(roster) <= need;
  const avail = available(st);
  const base = avail
    .filter((p) => slotFor(roster, p) != null && (!mustStart || fillsStarter(roster, p)))
    .sort((a, b) => (Number(a.svp) || 99999) - (Number(b.svp) || 99999));
  const supply = supplyOf(avail); const demand = demandOf(st.rosters);
  if (shortfall(supply, demand)) return base; // already short (an unchecked setup): no guard to keep
  const safe = base.filter((p) => {
    const el = eligible(p); const slot = roster[slotFor(roster, p)].slot;
    const s2 = {}; const d2 = {};
    for (const t of TYPES) { s2[t] = supply[t] - (el.has(t) ? 1 : 0); d2[t] = demand[t] - (slot === t ? 1 : 0); }
    return !shortfall(s2, d2);
  });
  return safe.length ? safe : base;
}

/** Is the must-start rule binding this seat now? */
export function mustStartNow(st, seat) {
  const roster = st.rosters[seat];
  const need = openStarters(roster).length;
  return need > 0 && picksLeft(roster) <= need;
}

/** Apply one pick (returns a NEW state). Throws on an illegal one. */
export function applyPick(st, playerId, by) {
  if (isDone(st)) throw new Error('draft is over');
  const seat = onClock(st);
  const player = st.pool.find((p) => p.id === playerId);
  if (!player || st.taken.has(playerId)) throw new Error(`player ${playerId} is not available`);
  if (!legalFor(st, seat).some((p) => p.id === playerId)) throw new Error(`illegal pick ${player.name} for seat ${seat + 1}`);
  const rosters = st.rosters.map((r, i) => (i === seat ? place(r, player) : r));
  const taken = new Set(st.taken); taken.add(playerId);
  return { ...st, rosters, taken, picks: [...st.picks, { n: nextPick(st), seat, id: playerId, by }] };
}

/**
 * A bot's pick: among its legal players, the best few by its key (ADP or SVP),
 * a bench-only player pushed back 25% while its starters are open, one of the
 * top three weighted 60/30/10 by the seeded dice. Never null while a slot is open.
 */
export function botPick(st, seat) {
  const roster = st.rosters[seat];
  const legal = legalFor(st, seat);
  if (!legal.length) return null;
  const scored = legal
    .map((p) => ({ p, k: keyOf(p, st.botKey) * (fillsStarter(roster, p) ? 1 : 1.25) }))
    .sort((a, b) => a.k - b.k || (a.p.svp ?? 0) - (b.p.svp ?? 0))
    .slice(0, 3);
  const weights = [0.6, 0.3, 0.1].slice(0, scored.length);
  let r = rng32((st.seed ^ (nextPick(st) * 2654435761)) >>> 0)() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < scored.length; i += 1) { r -= weights[i]; if (r < 0) return scored[i].p; }
  return scored[scored.length - 1].p;
}

/** Run the bots until the user is on the clock or the draft is over. */
export function runBots(st) {
  let s = st;
  while (!isDone(s) && onClock(s) !== s.userSeat) {
    const p = botPick(s, onClock(s));
    if (!p) throw new Error(`bot stalled at pick ${nextPick(s)}`);
    s = applyPick(s, p.id, 'bot');
  }
  return s;
}

/** The user's best available by SVP among legal players (auto-pick and auto-draft). */
export const bestFor = (st) => legalFor(st, st.userSeat)[0] ?? null;

/** THE CLOCK RAN OUT: the user's pick is made for them (top legal SVP), then the bots run. */
export function autoPickOnExpiry(st) {
  if (isDone(st) || onClock(st) !== st.userSeat) return st;
  const p = bestFor(st);
  return runBots(applyPick(st, p.id, 'auto'));
}

/** AUTO-DRAFT THE REST: every remaining user pick by SVP + legal positions, bots between. */
export function autoDraftRest(st) {
  let s = runBots(st);
  while (!isDone(s)) s = autoPickOnExpiry(s);
  return s;
}
