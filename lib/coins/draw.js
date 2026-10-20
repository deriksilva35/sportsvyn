// lib/coins/draw.js - THE DRAWING, PURE AND REPRODUCIBLE (Rules v0.1 s5).
//
// Anyone can rerun it from what the reveal page publishes:
//
//   1. THE TICKETS of a drum, in canonical order: every drop (drum_entries) in
//      id order, each expanded to `qty` tickets. Ticket i is the i-th coin.
//   2. THE SEED: the week's last NFL final as "AWAY n - HOME n".
//   3. THE RANDOM STREAM: r(k) = the first 6 bytes of
//      sha256("<seed>|<prize_key>|<k>") as an integer, k = 0, 1, 2, ...;
//      a value in the biased top slice for a range n is skipped (rejection),
//      so every pick is exactly uniform.
//   4. THE SHUFFLE: Fisher-Yates from the last ticket down, j = uniform(i + 1).
//   5. THE WINNERS: the first `count` tickets of the shuffle. One coin wins one
//      prize and is removed before the next is drawn, because a shuffle never
//      repeats a ticket; a player with two coins can win twice, as the rules say.

import { createHash } from 'node:crypto';

const SPAN = 2 ** 48;

/** A seeded stream of integers in [0, 2^48). */
export function stream(seed, prizeKey) {
  let k = 0;
  return () => {
    const h = createHash('sha256').update(`${seed}|${prizeKey}|${k}`).digest();
    k += 1;
    return h.readUIntBE(0, 6);
  };
}

/** A uniform integer in [0, n) from the stream, by rejection. */
export function uniform(next, n) {
  if (n <= 1) return 0;
  const limit = SPAN - (SPAN % n);
  for (;;) {
    const v = next();
    if (v < limit) return v % n;
  }
}

/** The shuffled order of ticket indices 0..n-1 for one drum. */
export function shuffleOrder(n, seed, prizeKey) {
  const order = Array.from({ length: n }, (_, i) => i);
  const next = stream(seed, prizeKey);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = uniform(next, i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Expand drops (sorted by id) into tickets: [{ user_id, entry_id }], one per coin. */
export function ticketsFrom(entries = []) {
  return [...entries].sort((a, b) => Number(a.id) - Number(b.id))
    .flatMap((e) => Array.from({ length: Number(e.qty) }, () => ({ user_id: Number(e.user_id), entry_id: Number(e.id) })));
}

/**
 * One drum's drawing -> { tickets, order, winners: [{ coin_index, user_id }] }.
 * Fewer coins than prizes: every coin wins and the rest go unawarded.
 */
export function drawDrum({ entries, seed, prizeKey, count }) {
  const tickets = ticketsFrom(entries);
  const order = shuffleOrder(tickets.length, seed, prizeKey);
  const winners = order.slice(0, Math.min(count, tickets.length)).map((i) => ({ coin_index: i, user_id: tickets[i].user_id }));
  return { tickets, order, winners };
}

/** "DET 27 - SEA 20" from a final. */
export const seedText = (m) => `${m.away_abbr} ${m.away_score} - ${m.home_abbr} ${m.home_score}`;
