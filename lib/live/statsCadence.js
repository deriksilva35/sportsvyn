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

/**
 * THE NBA PLAYS EXCEPTION (Derik's ruling thu-40). The house rule is ONE
 * cadence: whatever StatsTracker.due() says is due gets its box score AND its
 * plays (services/live-poller/index.mjs, MLB's pitches). Basketball breaks it
 * on purpose, for LIVE games only:
 *
 *   WHY. The NBA card prints the last play under the clock ("Q4 · 2:14 ...
 *   Tatum makes 26-foot three"), and the game page lists the plays with the
 *   running score. On the box cadence (every tenth poll, ~5 min) both trail
 *   the clock by up to five minutes - a card that says Q4 2:14 over a play
 *   from Q4 7:30 disagrees with itself. A basketball game moves ~2 plays a
 *   minute; a five-minute-old play is a different game state.
 *   COST. One /nba/v1/plays call per live game per 30 s poll - 2/min/game,
 *   ~30/min on a full 15-game night - against a 600/min key. Measured on the
 *   replay (lib/nba/replayRun.js reports callsPerLiveMin).
 *
 * THE BOX SCORE CADENCE IS UNCHANGED: the box still rides due() (every tenth
 * live poll and once at the final). A game that flips to final gets its plays
 * once more through due()'s 'final' entry, so the list closes on End Game.
 * PURE. @param matches [{id, status}] the window's watched games
 * @param due the list StatsTracker.due() returned for this poll
 * @returns [{ id, why: 'live' | 'final' }]
 */
export const NBA_PLAYS_EVERY_LIVE_POLL = true;
export function nbaPlaysDue({ matches = [], due = [] } = {}) {
  const out = (matches ?? []).filter((m) => m.status === 'live').map((m) => ({ id: m.id, why: 'live' }));
  for (const d of due ?? []) if (d.why === 'final' && !out.some((o) => o.id === d.id)) out.push({ id: d.id, why: 'final' });
  return out;
}
