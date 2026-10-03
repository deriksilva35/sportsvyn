// lib/cfb/finalKickRun.js - the DB-bound half of the CFB final kick (sun-6
// item 2). The throttle that decides WHEN is lib/cfb/finalKick.js; this is
// WHAT runs: importCfbWeek for each kicked week, in the live poller's process.
//
// IN-PROCESS, NOT A TRANSIENT systemd UNIT (contrast lib/mlb/advanceKick.js).
// The MLB advance is a CLI script with its own unit and lock file; this is one
// library call the poller can already make - it runs with --import
// services/_preload/prod-db.mjs, so lib/db.js is the same PROD client the
// Vercel cron uses, and CFBD_API_KEY is in its EnvironmentFile. A unit would
// add a service file and a script to install for nothing the call needs. The
// run is never awaited by the poll loop (the throttle fires it off-chain), and
// this function never throws: every failure is logged, recorded and returned.
//
// THE LOCK IS THE CRON'S: withAdvisoryLock(LOCK_SOURCE) with the cron's own
// SOURCE string, so the hourly fire and a kicked run can never overlap. A kick
// that finds the cron holding it records 'skipped-locked' and asks the
// throttle to go round again.
//
// THE LEDGER IS ITS OWN: sync_runs.source = KICK_SOURCE. maybeAlert rate-limits
// one mail per SOURCE per six hours, so sharing the cron's source would let a
// kick failure silence the cron's alarm (and the reverse) for an afternoon.
// Apart, each has its own alarm, and the ledger says which path landed a box.

import { sql as dbSql } from '../db.js';
import { importCfbWeek, rosterMap, matchMap } from './gameStatsImport.js';
import { withAdvisoryLock } from '../pollers/lock.js';
import { recordRun, recordDecision } from '../pollers/runRecorder.js';

/** The cron's SOURCE (app/api/cron/cfb-player-stats/route.js), used as the lock key. */
export const LOCK_SOURCE = 'cfb-player-stats';
/** The kick's own sync_runs / alert source. */
export const KICK_SOURCE = 'cfb-player-stats-kick';

/**
 * The (season, phase, week) each kicked final belongs to - CFBD's week, as
 * syncCfbGames wrote it to matches.week, never a contest key. Non-CFB ids match
 * nothing.
 */
export async function cfbFinalWeeks(sql, ids) {
  const list = [...new Set((ids ?? []).filter((x) => x != null).map(Number))];
  if (!list.length) return [];
  const rows = await sql`
    SELECT m.id, m.season_year, m.season_phase, m.week
      FROM matches m JOIN leagues lg ON lg.id = m.league_id AND lg.slug = 'cfb'
     WHERE m.id = ANY(${list}::int[]) AND m.week IS NOT NULL AND m.season_year IS NOT NULL`;
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.season_year}|${r.season_phase}|${r.week}`;
    const cur = byKey.get(k) ?? { season: Number(r.season_year), phase: r.season_phase ?? 'REG', week: Number(r.week), matchIds: [] };
    cur.matchIds.push(Number(r.id));
    byKey.set(k, cur);
  }
  return [...byKey.values()];
}

/**
 * Run one kicked batch. Resolves { requeue } - the items whose kicked matches
 * still hold no box-score rows (CFBD not yet published), or the whole batch
 * when the run was locked out or failed. Never throws.
 */
export async function runKickedImport(batch, {
  sql = dbSql, log = () => {},
  lock = withAdvisoryLock, record = recordRun, decide = recordDecision,
  importWeek = importCfbWeek, roster = rosterMap, matchesFor = matchMap,
  alert = null,
} = {}) {
  const items = batch ?? [];
  if (!items.length) return { requeue: [] };
  const weeks = items.map((i) => `${i.season}/${i.phase}/${i.week}`);
  try {
    const outcome = await lock(LOCK_SOURCE, () => record(sql, {
      source: KICK_SOURCE, kind: 'import', log,
      run: async () => {
        const rmap = await roster();
        const mmaps = new Map();
        const per = [];
        let requests = 0, inserted = 0, updated = 0;
        for (const it of items) {
          if (!mmaps.has(it.season)) mmaps.set(it.season, await matchesFor(it.season));
          const r = await importWeek(it.season, it.week, {
            seasonPhase: it.phase, roster: rmap, matches: mmaps.get(it.season),
          });
          requests += r.requests ?? 1; inserted += r.inserted ?? 0; updated += r.updated ?? 0;
          per.push({ week: it.week, phase: it.phase, inserted: r.inserted, updated: r.updated,
            noGame: r.noGame, noPlayer: r.noPlayer, kicked: it.matchIds });
        }
        const ids = [...new Set(items.flatMap((i) => i.matchIds ?? []))];
        const held = ids.length ? await sql`
          SELECT DISTINCT match_id FROM cfb_player_game_stats WHERE match_id = ANY(${ids}::int[])` : [];
        const have = new Set(held.map((h) => Number(h.match_id)));
        const missing = ids.filter((id) => !have.has(id));
        return { weeks, requests, inserted, updated, missing, per };
      },
    }));

    if (outcome.locked) {
      await decide(sql, { source: KICK_SOURCE, kind: 'skipped-locked', summary: { weeks } }).catch(() => {});
      log(`[cfb] final-kick ${weeks.join(',')} skipped: the hourly cron holds the lock - next window`);
      return { requeue: items };
    }
    const res = outcome.result;
    if (!res.ok) {
      const send = alert ?? (await import('../pollers/alerts.js')).maybeAlert;
      await send(sql, {
        source: KICK_SOURCE,
        subject: '[cfb] final-kick box-score import FAILED',
        body: `weeks: ${weeks.join(', ')}\n\n${String(res.error ?? 'unknown error')}`,
      }).catch((e) => log('[cfb] final-kick alert failed:', String(e?.message ?? e).slice(0, 120)));
      return { requeue: items };
    }
    const missing = new Set(res.summary?.missing ?? []);
    log(`[cfb] final-kick ${weeks.join(',')} inserted=${res.summary?.inserted ?? 0} updated=${res.summary?.updated ?? 0} missing=${missing.size}`);
    const requeue = items
      .map((i) => ({ ...i, matchIds: (i.matchIds ?? []).filter((id) => missing.has(id)) }))
      .filter((i) => i.matchIds.length);
    return { requeue };
  } catch (e) {
    log('[cfb] final-kick run failed:', String(e?.message ?? e).slice(0, 160));
    return { requeue: items };
  }
}
