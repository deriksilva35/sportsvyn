// lib/six/tick.js - Tonight's Six's hourly step, run by /api/cron/nba-schedule
// right after the NBA Pick'em tick (so it reads the tips the re-sync wrote).
// NO CRON OF ITS OWN: the hook that opens the day board opens this card.
//
//   1. open tonight's card (its 6 AM ET open has passed) and build its pool
//   2. refresh injuries on every card still pickable - Out moves all day
//   3. keep every unsettled card's locks_at its current last tip
//   4. settle what is final AND boxed (lib/six/settle.js refuses the rest)
//
// Each step is caught on its own: a failed open must not stop last night's
// card from settling.

import { sql } from '../db.js';
import { ensureSixNight, sixNightFor, refreshSixLocks, GAME_TYPE, SPORT } from './night.js';
import { buildSixPool, refreshSixInjuries } from './pool.js';
import { settleDueSix } from './settle.js';

const err = (e) => ({ error: String(e?.message ?? e).slice(0, 300) });

export async function sixTick({ now = new Date() } = {}) {
  const out = {};
  out.night = await ensureSixNight({ now }).catch(err);
  // THE POOL, built on the pass that opened the card - or on any later pass
  // whose earlier build came back incomplete (and so was never cached).
  if (out.night?.dayEt) {
    const c = await sixNightFor(out.night.dayEt).catch(() => null);
    if (c && !c.meta?.pool?.byGame) {
      out.pool = await buildSixPool(c).then((p) => ({ games: Object.keys(p.byGame).length, incomplete: p.incomplete })).catch(err);
    }
  }
  out.injuries = await (async () => {
    const open = await sql`
      SELECT id, board, meta FROM contests
       WHERE game_type = ${GAME_TYPE} AND sport = ${SPORT} AND NOT settled
         AND opens_at <= ${new Date(now).toISOString()} AND locks_at > ${new Date(now).toISOString()}`;
    let n = 0;
    for (const c of open) { await refreshSixInjuries(c, { now }); n += 1; }
    return n;
  })().catch(err);
  out.locks = await refreshSixLocks().then((r) => r.length).catch(err);
  out.settle = await settleDueSix({ now }).catch(err);
  return out;
}

/** Every error a tick carried, flattened for the run recorder. */
export function tickErrors(t) {
  return [t?.night?.error, t?.pool?.error, t?.injuries?.error, t?.locks?.error, t?.settle?.error,
    ...((t?.settle?.results ?? []).filter((r) => r.error).map((r) => `contest ${r.contestId}: ${r.error}`))].filter(Boolean);
}
