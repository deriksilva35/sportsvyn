// lib/mockNba/draft.js - the NBA mock draft, run entirely as pure state (sun-5).
//
// 12 TEAMS x 13 ROUNDS, SNAKE. The browser holds the state and calls these
// functions; nothing is stored server-side, which is why the page plays signed
// out with no guest machinery: there is nothing to keep. The bots are seeded
// (seed, pick number), so a draft replays exactly from its seed and the user's
// picks.

import { ROUNDS, TEAMS, emptyRoster, place, openStarters, fillsStarter, slotFor } from './roster.js';

export const TOTAL = TEAMS * ROUNDS; // 156

/** Seat index (0-based) on the clock at overall pick n (1-based). */
export function seatAt(n) {
  const i = n - 1; const r = Math.floor(i / TEAMS); const k = i % TEAMS;
  return r % 2 === 0 ? k : TEAMS - 1 - k;
}
export const roundOf = (n) => Math.floor((n - 1) / TEAMS) + 1;

// mulberry32
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A new mock. `pool` best-first by sv; `userSeat` 0-11. */
export function createMock(pool, { userSeat, seed }) {
  return {
    seed: seed >>> 0, userSeat,
    pool, picks: [], taken: new Set(),
    rosters: Array.from({ length: TEAMS }, () => emptyRoster()),
  };
}

export const nextPick = (st) => st.picks.length + 1;
export const isDone = (st) => st.picks.length >= TOTAL;
export const onClock = (st) => (isDone(st) ? null : seatAt(nextPick(st)));
export const available = (st) => st.pool.filter((p) => !st.taken.has(p.id));
const picksLeft = (roster) => roster.filter((r) => !r.player).length;

/**
 * Who a seat MAY take now. Anyone with a slot - but once the picks left equal
 * the empty starting slots, only a player who fills one: no roster ends with a
 * hole in its starting nine. The same rule binds the user.
 */
export function legalFor(st, seat) {
  const roster = st.rosters[seat];
  const need = openStarters(roster).length;
  const mustStart = need > 0 && picksLeft(roster) <= need;
  return available(st).filter((p) => slotFor(roster, p) != null && (!mustStart || fillsStarter(roster, p)));
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
 * A bot's pick: among its legal players, the best few by SV with a pull toward
 * an empty starting slot (a bench player is worth 80% to a bot whose starters
 * are open), one of the top three weighted 60/30/10 by the seeded dice.
 * Never null while the seat has a slot.
 */
export function botPick(st, seat) {
  const roster = st.rosters[seat];
  const legal = legalFor(st, seat).slice(0, 12);
  if (!legal.length) return null;
  const scored = legal.map((p) => ({ p, w: (p.sv ?? 0) * (fillsStarter(roster, p) ? 1 : 0.8) }))
    .sort((a, b) => b.w - a.w || a.p.rank - b.p.rank);
  const top = scored.slice(0, 3);
  const weights = [0.6, 0.3, 0.1].slice(0, top.length);
  let r = rng32((st.seed ^ (nextPick(st) * 2654435761)) >>> 0)() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < top.length; i += 1) { r -= weights[i]; if (r < 0) return top[i].p; }
  return top[top.length - 1].p;
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

/** The user's best available (top legal SV): what a "pick for me" would take. */
export const bestFor = (st) => legalFor(st, st.userSeat)[0] ?? null;
