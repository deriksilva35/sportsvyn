// lib/live/statsCadence.js - WHEN THE LIVE POLLER PULLS A BOX SCORE. Pure.
// While a game is live: every 10th live poll (LIVE_SEC 30 -> every 5 min).
// When a game the tracker saw live flips to final: once. Never for a game
// it never saw live (the post-final sweep covers those). Budget: a 3h game
// is ~36 live calls -> at most ~4 box pulls + 1 at final, well under 15.
export const STATS_EVERY_NTH_POLL = 10;

export class StatsTracker {
  constructor({ every = STATS_EVERY_NTH_POLL } = {}) { this.every = every; this.seen = new Map(); this.finalDone = new Set(); }
  /** @param polls the window's live poll count after this poll; @param matches [{id, status}] */
  due({ polls, matches }) {
    const out = [];
    for (const m of matches ?? []) {
      const prev = this.seen.get(m.id);
      if (m.status === 'live') {
        this.seen.set(m.id, 'live');
        if (polls % this.every === 0) out.push({ id: m.id, why: 'live' });
      } else if (m.status === 'final' && prev === 'live' && !this.finalDone.has(m.id)) {
        this.finalDone.add(m.id); this.seen.set(m.id, 'final');
        out.push({ id: m.id, why: 'final' });
      }
    }
    return out;
  }
}
