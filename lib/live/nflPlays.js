// lib/live/nflPlays.js - NFL PLAY-BY-PLAY EVERY 30 SECONDS, FROM THE LIVE POLLER (drive-2).
//
// WHY HERE. The drive card's down, spot and scoring moment want NFL plays every
// 30 s. /api/cron/plays-live is a Vercel cron at `* * * * *`, so a 30 s interval
// there is a 60 s read. This process already loops every 30 s while a game is
// live and holds the BDL key (flat plan: a call costs nothing), so the NFL plays
// import runs from the NFL loop, once per live game per tick, through the same
// importPlaysFor the cron uses - same writes, same drive envelopes.
//
// IT NEVER BLOCKS THE SCORE POLL. A game's import is one BDL request per page
// and one INSERT per play, which on a long game is seconds; run inline it would
// push the next score poll past its 30 s. So imports are STARTED here and left
// to finish on their own (at most `pool` at once, never two for one game), and
// every failure is caught, counted and logged - a plays outage costs the drive
// strip, never a score.
//
// WHO ELSE READS NFL PLAYS: the cron, only as a backstop for a down poller
// (playsCadence.js nflBackstopSec). Both sides judge "due" by plays.updated_at,
// which every import moves, so a healthy poller keeps the backstop silent and
// nothing is read twice. Freshness stays visible where it always was:
// importNflPlays writes matches.metadata.drives and matches.updated_at (the
// crew provider_freshness_v 'bdl' row), and this module's counters ride the
// live-poller window and heartbeat rows (nflPlays / nflPlaysFailed / nflPlaysAt).

import { dueByState, PLAYS_CADENCE } from '../pollers/playsCadence.js';

// The loop sleeps ~30 s between polls plus the poll's own run time, so a game
// polled one tick ago is a few seconds SHORT of 30 s when the next tick looks.
// Without slack that tick skips it and the real cadence is 60 s.
export const TICK_SLACK_MS = 5_000;
export const POOL = 3;

/** Live NFL games, as dueByState wants them. */
export async function liveNflGames(sql) {
  const rows = await sql`
    SELECT m.id, m.slug FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.status = 'live' ORDER BY m.kickoff_at`;
  return rows.map((r) => ({ id: r.id, slug: r.slug, league: 'nfl', on_board: false, plays_poll: null }));
}

/** When each game's plays were last written (the cron's own clock). */
export async function playsWrittenAt(sql, ids) {
  if (!ids.length) return new Map();
  const rows = await sql`SELECT match_id, max(updated_at) AS at FROM plays WHERE match_id = ANY(${ids}) GROUP BY match_id`;
  return new Map(rows.map((r) => [r.match_id, r.at]));
}

/**
 * @param importFn async (matchId) => { written, drives, pages }  (importPlaysFor)
 * @param listFn   async () => games       (liveNflGames bound to the poller's sql)
 * @param lastFn   async (ids) => Map(id -> at)
 */
export function createNflPlays({ importFn, listFn, lastFn, log = () => {}, pool = POOL, cfg = PLAYS_CADENCE } = {}) {
  const inFlight = new Set();
  const pending = new Set();
  let counters = { imported: 0, failed: 0, calls: 0, lastOkAt: null };

  async function run(g) {
    try {
      const r = await importFn(g.id);
      counters.imported += 1;
      counters.calls += Number(r?.pages ?? 1);
      counters.lastOkAt = new Date().toISOString();
    } catch (e) {
      counters.failed += 1;
      log(`[nfl] plays import failed match=${g.id}: ${String(e?.message ?? e).slice(0, 120)}`);
    } finally {
      inFlight.delete(g.id);
    }
  }

  return {
    /** Start what is due. Returns at once with { due, started }; never throws. */
    async tick(now = new Date()) {
      try {
        const games = await listFn();
        if (!games.length) return { due: 0, started: 0 };
        const last = await lastFn(games.map((g) => g.id));
        const due = dueByState(games, last, new Date(new Date(now).getTime() + TICK_SLACK_MS), cfg)
          .filter((g) => !inFlight.has(g.id));
        let started = 0;
        for (const g of due) {
          if (inFlight.size >= pool) break;
          inFlight.add(g.id);
          const p = run(g);
          pending.add(p); p.finally(() => pending.delete(p));
          started += 1;
        }
        return { due: due.length, started };
      } catch (e) {
        counters.failed += 1;
        log(`[nfl] plays tick failed: ${String(e?.message ?? e).slice(0, 120)}`);
        return { due: 0, started: 0, error: true };
      }
    },
    /** The counters since the last drain; resets them (lastOkAt is kept). */
    drain() {
      const out = { ...counters };
      counters = { imported: 0, failed: 0, calls: 0, lastOkAt: counters.lastOkAt };
      return out;
    },
    /** Resolves when every started import has finished (tests). */
    async idle() { while (pending.size) await Promise.allSettled([...pending]); },
    get inFlight() { return inFlight; },
    get lastOkAt() { return counters.lastOkAt; },
  };
}
