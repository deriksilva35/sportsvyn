// services/live-poller/index.mjs — the droplet's live loop. ONE PROCESS, ONE
// LOOP PER LEAGUE, and as thin as it can be: every decision it makes was made
// in a pure module under lib/live/ and tested without a network or a clock.
//
// WHY IT IS NOT A CRON. Vercel's minimum cron granularity is a minute, and a
// minute is not fast enough for a score. This is a long-lived process on a box
// that is already always on, holding an advisory lock so the Vercel tick knows
// to stand back.
//
// WHAT IT WRITES: status, both scores, metadata.live_state,
// metadata.detail.final_seen_at. What it never touches: drives, plays,
// line_scores, broadcasts, kickoff_at, teams, week. Those have their own
// writers on their own cadences.

import { neon } from '@neondatabase/serverless';
import { cadence, sleepUntilNext } from '../../lib/live/cadence.js';
import { addCalls, callsToday, applyCap, overCap, DEFAULT_CAP } from '../../lib/live/quota.js';
import { LIVE_LOCK } from '../../lib/live/handshake.js';
import { withAdvisoryLock, directConnectionString, lockKey } from '../../lib/pollers/lock.js';
import { pollOnce, cfbdScoreboard, bdlDay, fromCfbd, fromBdl } from './poll.mjs';
import * as neonmod from '@neondatabase/serverless';

const { Client } = neonmod;
const DB = process.env.PROD_DATABASE_URL;
if (!DB) { console.error('PROD_DATABASE_URL missing'); process.exit(1); }
const sql = neon(DB);

const HEARTBEAT_MS = 5 * 60 * 1000;
const ALERT_AFTER_FAILURES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

const LEAGUES = [
  { slug: 'cfb', providerKey: 'cfbd_game_id', normalise: fromCfbd,
    fetcher: () => cfbdScoreboard()() },
  { slug: 'nfl', providerKey: 'bdl_game_id', normalise: fromBdl,
    fetcher: (now) => bdlDay(new Date(now).toISOString().slice(0, 10))() },
];

async function slate(league, now) {
  return sql`
    SELECT m.status, m.kickoff_at AS "kickoffAt",
           (m.metadata->'detail'->>'final_seen_at') AS "finalSeenAt"
      FROM matches m JOIN leagues l ON l.id = m.league_id AND l.slug = ${league}
     WHERE m.kickoff_at BETWEEN ${now.toISOString()}::timestamptz - interval '8 hours'
                            AND ${now.toISOString()}::timestamptz + interval '18 hours'`;
}

/** One ledger row per POLL WINDOW, not per poll. */
async function openWindow(league, state) {
  const r = await sql`
    INSERT INTO sync_runs (source, kind, started_at, ok)
    VALUES (${`live-poller-${league}`}, ${`window:${state}`}, now(), false) RETURNING id`;
  return r[0].id;
}
async function closeWindow(id, summary, ok = true) {
  await sql`UPDATE sync_runs SET finished_at = now(), ok = ${ok},
            summary = ${JSON.stringify(summary)}::jsonb WHERE id = ${id}`;
}

/**
 * THE HEARTBEAT EXISTS SO A DEAD LOOP IS VISIBLE. An unledgered poller is
 * unauditable: with only window rows, a process that died on a Tuesday and a
 * process correctly idle on a Tuesday write exactly the same thing, which is
 * nothing. Five minutes, always, in every state.
 */
async function heartbeat(league, state, extra) {
  await sql`
    INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
    VALUES (${`live-poller-${league}`}, 'heartbeat', now(), now(), true,
            ${JSON.stringify({ state, pid: process.pid, ...extra })}::jsonb)`;
}

/**
 * THE LOCK IS HELD FOR THE WHOLE LIVE WINDOW, not per poll. Taking and dropping
 * it every thirty seconds would leave a gap on every cycle that the Vercel tick
 * could land in, which is the collision the lock exists to prevent. So a live
 * window opens one session, keeps it, and closes it when the window does.
 */
async function acquire(league) {
  const client = new Client(directConnectionString(DB));
  await client.connect();
  const got = (await client.query('SELECT pg_try_advisory_lock($1) AS ok', [lockKey(LIVE_LOCK(league))])).rows[0].ok;
  if (!got) { await client.end(); return null; }
  return client;
}
async function release(client, league) {
  if (!client) return;
  try { await client.query('SELECT pg_advisory_unlock($1)', [lockKey(LIVE_LOCK(league))]); }
  finally { await client.end(); }
}

async function loop(lg) {
  let lock = null, windowId = null, failures = 0, pending = 0, lastBeat = 0;
  const window = { polls: 0, scoreChanges: 0, finals: 0, events: 0, calls: 0, unmapped: [], latencies: [] };

  for (;;) {
    const now = new Date();
    let decision;
    try {
      decision = cadence(await slate(lg.slug, now), now);
    } catch (e) {
      log(`[${lg.slug}] slate read failed:`, e.message);
      await sleep(30000); continue;
    }

    const spent = await callsToday(sql, lg.slug, now).catch(() => 0);
    decision = applyCap(decision, spent + pending, lg.slug);
    const active = decision.state !== 'idle' && !decision.state.startsWith('idle');

    // --- lock + window lifecycle -----------------------------------------
    if (active && !lock) {
      lock = await acquire(lg.slug);
      if (!lock) log(`[${lg.slug}] another holder has the live lock; polling anyway is not safe - waiting`);
      else { windowId = await openWindow(lg.slug, decision.state); log(`[${lg.slug}] window open (${decision.state})`); }
    }
    if (!active && lock) {
      await closeWindow(windowId, { ...window, closedState: decision.state });
      await release(lock, lg.slug); lock = null; windowId = null;
      Object.assign(window, { polls: 0, scoreChanges: 0, finals: 0, events: 0, calls: 0, unmapped: [], latencies: [] });
      log(`[${lg.slug}] window closed`);
    }

    // --- the poll ---------------------------------------------------------
    if (active && lock && !decision.capped) {
      try {
        const r = await pollOnce(sql, {
          league: lg.slug, providerKey: lg.providerKey,
          fetcher: () => lg.fetcher(now), normalise: lg.normalise, now,
        });
        failures = 0;
        pending += r.calls;
        window.polls += 1; window.calls += r.calls;
        window.scoreChanges += r.scoreChanges; window.finals += r.finals;
        window.events += r.events;
        window.latencies.push(...r.latencies);
        for (const u of r.unmapped) if (!window.unmapped.includes(u)) window.unmapped.push(u);
        if (r.scoreChanges) log(`[${lg.slug}] ${r.scoreChanges} score change(s), ${r.events} event(s)`);
        if (r.unmapped.length) log(`[${lg.slug}] UNMAPPED STATUS:`, r.unmapped.join(', '));
      } catch (e) {
        failures += 1;
        log(`[${lg.slug}] poll failed (${failures}):`, e.message);
        if (failures >= ALERT_AFTER_FAILURES) {
          const { maybeAlert } = await import('../../lib/pollers/alerts.js');
          await maybeAlert(sql, {
            source: `live-poller-${lg.slug}`,
            subject: `live poller: ${failures} consecutive fetch failures`,
            body: String(e?.message ?? e).slice(0, 800),
          }).catch(() => {});
          failures = 0;
        }
      }
    }

    // --- heartbeat + quota flush -----------------------------------------
    if (Date.now() - lastBeat >= HEARTBEAT_MS) {
      const total = pending ? await addCalls(sql, lg.slug, pending, now).catch(() => null) : spent;
      pending = 0; lastBeat = Date.now();
      await heartbeat(lg.slug, decision.state, { callsToday: total, cap: DEFAULT_CAP[lg.slug], live: decision.liveCount }).catch(() => {});
      if (overCap(total, lg.slug)) {
        const { maybeAlert } = await import('../../lib/pollers/alerts.js');
        await maybeAlert(sql, {
          source: `live-poller-${lg.slug}`,
          subject: `live poller: ${lg.slug} hit its daily provider cap`,
          body: `${total} calls today against a cap of ${DEFAULT_CAP[lg.slug]}. Dropped to the idle cadence.`,
        }).catch(() => {});
      }
    }

    await sleep(sleepUntilNext(decision, now) * 1000);
  }
}

for (const lg of LEAGUES) {
  loop(lg).catch((e) => { console.error(`[${lg.slug}] loop died:`, e); process.exit(1); });
}
log('live-poller up:', LEAGUES.map((l) => l.slug).join(', '));
