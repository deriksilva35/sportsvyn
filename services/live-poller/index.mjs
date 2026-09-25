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
import { cadence, sleepUntilNext, kickoffDelta } from '../../lib/live/cadence.js';
import { addCalls, callsToday, applyCap, overCap, DEFAULT_CAP } from '../../lib/live/quota.js';
import { StatsTracker } from '../../lib/live/statsCadence.js';
import { syncGameStats } from '../../lib/gridiron/gameStatsSync.js';
import { syncMlbGameStats } from '../../lib/mlb/statsSync.js';
import { syncMlbPlays } from '../../lib/mlb/playsSync.js';
import { LIVE_LOCK } from '../../lib/live/handshake.js';
import { withAdvisoryLock, directConnectionString, lockKey } from '../../lib/pollers/lock.js';
import { pollOnce, sweepLostFinals, cfbdScoreboard, bdlDay, mlbDay, fromCfbd, fromBdl, fromMlb, mlbDetail, mlbEnrich, mlbKickoff } from './poll.mjs';
import { sportOf } from '../../lib/live/vocabulary.js';
import { dispatch } from '../../lib/push/dispatch.js';
import { drainPushCounts } from '../../lib/push/warn.js';
import { execSync } from 'node:child_process';
import * as neonmod from '@neondatabase/serverless';

const { Client } = neonmod;
const DB = process.env.PROD_DATABASE_URL;
if (!DB) { console.error('PROD_DATABASE_URL missing'); process.exit(1); }
const sql = neon(DB);

const HEARTBEAT_MS = 5 * 60 * 1000;
const ALERT_AFTER_FAILURES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

// THE RUNNING COMMIT, RESOLVED ONCE AT STARTUP (defect 4). Node caches
// modules at import, so a process started before a deploy runs the OLD code
// with no way to tell from the outside - which is exactly how 89b168e sat on
// disk unused for 22 hours while the poller kept sending bare-word prefixes.
// Read from git rather than an env var so it cannot be set and then lie.
const HEAD = (() => {
  try { return execSync('git rev-parse --short HEAD', { cwd: process.cwd() }).toString().trim(); }
  catch { return 'unknown'; }
})();

const LEAGUES = [
  { slug: 'cfb', providerKey: 'cfbd_game_id', normalise: fromCfbd,
    fetcher: () => cfbdScoreboard()() },
  { slug: 'nfl', providerKey: 'bdl_game_id', normalise: fromBdl,
    fetcher: (now) => bdlDay(new Date(now).toISOString().slice(0, 10))() },
  // MLB. SAME CADENCE AS THE NFL - one slate call per poll - but its live
  // state needs a SECOND call per live game: /games carries the inning and
  // nothing else, and the outs and the count are only on /plays, whose param
  // is singular. `enrich` is how a league says so; the two football leagues
  // pass none and the loop is unchanged for them.
  //
  // TWO DAYS, NOT ONE. A 01:45Z first pitch belongs to the previous calendar
  // day in every American sense and to today in UTC; asking for both is one
  // extra call against a 600/minute key and is the difference between seeing
  // a west-coast game and not.
  { slug: 'mlb', providerKey: 'bdl_game_id', normalise: fromMlb,
    fetcher: async (now) => {
      const day = (offset) => new Date(new Date(now).getTime() + offset * 86_400_000)
        .toISOString().slice(0, 10);
      const [a, b] = await Promise.all([mlbDay(day(0))(), mlbDay(day(-1))()]);
      const seen = new Set();
      const rows = [...a.rows, ...b.rows].filter((r) => {
        const k = String(r?.id);
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
      return { rows, calls: a.calls + b.calls };
    },
    // TWO PROVIDERS IN ONE ENRICHMENT: BDL's newest play carries the outs and
    // the count; statsapi's game feed carries the runners, the batter and the
    // pitcher, which BDL does not have at all. mlbEnrich does the gamePk
    // resolution once per game and stores it on the row.
    enrich: mlbEnrich,
    // AND IT RUNS BEFORE FIRST PITCH, for MLB alone. The posted batting order
    // is the bats October and The Run offer; it goes up two or three hours
    // before the game and is changed again on a scratch, so an enrichment that
    // only ran on live rows would see it for the first time when it was already
    // too late to pick against. lineupDue() holds the call rate down.
    enrichScheduled: true,
    // AND THE CANDIDATE WINDOW REACHES AS FAR AHEAD AS lineupDue DOES. Four
    // hours, because that is when batting orders start going up; with the
    // default thirty minutes the pre-kick pass could never see a game in time
    // to be worth picking against. Football keeps the default.
    futureMinutes: 240,
    // AND THE LOOP STAYS AWAKE THAT LONG, SLOWLY. The candidate window reaching
    // four hours ahead buys nothing while the loop is IDLE - pollOnce does not
    // run at all then - and the default pre-kick window is ten minutes, so a
    // batting order posted at 1pm for a 4pm game was still unseen at 3:50.
    // Four hours at five-minute polls, against ten minutes at thirty seconds
    // for the football leagues, which are untouched.
    cadenceOpts: { preKickMin: 240, preKickSec: 300 },
    // THE LINE SCORE AND THE SCORING SUMMARY, which writeLive is forbidden and
    // which are on the row we already hold. Football's equivalents arrive from
    // a different provider on a different cadence and have their own jobs;
    // baseball's do not exist anywhere else, so the poller writes them through
    // lib/mlb/detail.js - a separate statement over separate keys. Without
    // this the game page has no line score and the card no last scoring play,
    // on every game, forever.
    detail: mlbDetail,
    // AND THE FIRST PITCH IS THE PROVIDER'S. A game moved on the day is
    // corrected on the next poll rather than on the next schedule re-sync.
    kickoffOf: mlbKickoff },
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
            ${JSON.stringify({
              state, pid: process.pid, head: HEAD,
              // payloadNull / audienceEmpty ride every heartbeat (defect 3),
              // so a window that dropped pushes says so in the ledger rather
              // than looking identical to a quiet one.
              ...drainPushCounts(),
              ...extra,
            })}::jsonb)`;
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
  const window = { polls: 0, scoreChanges: 0, finals: 0, events: 0, calls: 0, unmapped: [], latencies: [], statsCalls: 0, lineups: 0, probables: 0, plays: 0 };
  // BOX SCORE PULLS: every 10th live poll per live game, once at final.
  // MLB JOINS ON THE SAME TRACKER. Its ingest existed and was called by
  // nothing, so mlb_player_game_stats stayed empty on every game ever played -
  // which would have settled every October card and every Run roster to zero,
  // healthily. One shared cadence, two sports, one quota count.
  const stats = (lg.slug === 'nfl' || lg.slug === 'mlb') ? new StatsTracker() : null;
  let statsCallsToday = 0;

  for (;;) {
    const now = new Date();
    let decision;
    try {
      decision = cadence(await slate(lg.slug, now), now, lg.cadenceOpts ?? {});
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
      else { windowId = await openWindow(lg.slug, decision.state); log(`[${lg.slug}] window open (${decision.state}) ${kickoffDelta(decision.nextKickoffAt, now)}`); }
    }
    if (!active && lock) {
      await closeWindow(windowId, { ...window, closedState: decision.state });
      await release(lock, lg.slug); lock = null; windowId = null;
      Object.assign(window, { polls: 0, scoreChanges: 0, finals: 0, events: 0, calls: 0, unmapped: [], latencies: [], statsCalls: 0, lineups: 0, probables: 0, plays: 0 });
      log(`[${lg.slug}] window closed (${decision.state}) ${kickoffDelta(decision.nextKickoffAt, now)}`);
    }

    // --- the poll ---------------------------------------------------------
    if (active && lock && !decision.capped) {
      try {
        const r = await pollOnce(sql, {
          league: lg.slug, providerKey: lg.providerKey,
          fetcher: () => lg.fetcher(now), normalise: lg.normalise,
          enrich: lg.enrich ?? null, enrichScheduled: lg.enrichScheduled === true,
          // THE REGISTRY'S detail AND kickoffOf REACH pollOnce. detail was
          // declared on MLB's entry from 22 Sep and never passed here, so the
          // line score and scoring summary filled only when somebody re-ran
          // the schedule import by hand: 0 of 17 finals on 24-25 Sep had a
          // grid. cronWiring-style source test: services/live-poller/mlbBdl.test.mjs.
          detail: lg.detail ?? null, kickoffOf: lg.kickoffOf ?? null,
          futureMinutes: lg.futureMinutes ?? 30, now, log,
        });
        // THE LOST-FINAL SWEEP rides the same tick and the same window
        // (defect 2). Cheap - one indexed read that is empty on almost
        // every poll - and contained, so a failure here never costs the
        // poll that just succeeded.
        try {
          const sw = await sweepLostFinals(sql, { league: lg.slug, now, dispatchFn: dispatch, log });
          if (sw.stamped) log(`[${lg.slug}] lost finals swept: ${sw.stamped} (emitted ${sw.emitted})`);
        } catch (e) {
          log(`[${lg.slug}] lost-final sweep failed:`, String(e?.message ?? e).slice(0, 120));
        }
        failures = 0;
        pending += r.calls;
        window.polls += 1; window.calls += r.calls;
        window.scoreChanges += r.scoreChanges; window.finals += r.finals;
        // LINEUP WRITES RIDE THE LEDGER. A window that posted no batting order
        // and a window whose pre-kick pass silently stopped running look the
        // same from outside without a count.
        window.lineups += r.lineups ?? 0;
        window.probables += r.probables ?? 0;
        window.events += r.events;
        window.latencies.push(...r.latencies);
        for (const u of r.unmapped) if (!window.unmapped.includes(u)) window.unmapped.push(u);
        if (r.scoreChanges) log(`[${lg.slug}] ${r.scoreChanges} score change(s), ${r.events} event(s)`);
        // THE LIVE ACTIVITY RIDER, IN THE JOURNAL. Without a line here the
        // rider is invisible: a night where every card froze and a night where
        // nobody had one open read exactly the same. Only polls that found an
        // Activity log at all (poll.mjs drops the empty ones).
        for (const la of r.liveActivities ?? []) {
          // PER ACTIVITY, PER HOUR, ON THE SAME LINE. Without it the only way
          // to answer "how many pushes has this card taken" was to grep the
          // journal and trust its retention; the cadence this relay sets is
          // judged on exactly that number, so it is stated rather than counted
          // afterwards. Shortened ids: the line is read at a glance, and the
          // first eight are enough to tell two cards on one match apart.
          const per = Object.entries(la.perHour ?? {})
            .map(([id, n]) => `${id.slice(0, 8)}=${n}`).join(' ');
          log(`[${lg.slug}] live activity ${la.event} match=${la.matchId} of=${la.activities} sent=${la.sent} failed=${la.failed} revoked=${la.revoked} skipped=${la.skipped}${per ? ` hr[${per}]` : ''}`);
        }
        if (r.unmapped.length) log(`[${lg.slug}] UNMAPPED STATUS:`, r.unmapped.join(', '));
        if (stats) {
          // the games this window is watching: live now, or seen live earlier
          // (so a flip to final is caught once). One row read, no provider call.
          const seenIds = [...stats.seen.keys()];
          const watched = await sql`
            SELECT m.id, m.status FROM matches m JOIN leagues l ON l.id = m.league_id
             WHERE l.slug = ${lg.slug} AND (m.status = 'live' OR m.id = ANY(${seenIds}::int[]))`;
          const syncBox = lg.slug === 'mlb' ? syncMlbGameStats : syncGameStats;
          for (const d of stats.due({ polls: window.polls, matches: watched })) {
            try {
              const g = await syncBox(d.id);
              pending += g.calls; window.calls += g.calls; window.statsCalls += g.calls; statsCallsToday += g.calls;
              log(`[${lg.slug}] box score ${d.why} match=${g.matchId} rows=${g.rows} changed=${g.changed} calls=${g.calls}`);
              // THE PITCHES RIDE THE SAME CADENCE AS THE BOX, and the same
              // decision: whatever stats.due() says is due gets both. A second
              // tracker would be a second answer to "how often is often
              // enough", and the two reads are about the same game at the same
              // moment - a box score whose plays are a poll behind is a page
              // that disagrees with itself.
              //
              // ITS FAILURE IS ITS OWN. The box score is what October and The
              // Run settle against; the pitch list is a tab. Losing the tab
              // must never cost the scoring.
              if (lg.slug === 'mlb') {
                try {
                  const pl = await syncMlbPlays(d.id);
                  pending += pl.calls; window.calls += pl.calls; window.statsCalls += pl.calls; statsCallsToday += pl.calls;
                  window.plays += pl.changed ?? 0;
                  log(`[mlb] plays ${d.why} match=${pl.matchId} rows=${pl.rows} changed=${pl.changed} calls=${pl.calls}`);
                } catch (e) {
                  log(`[mlb] plays ${d.why} match=${d.id} failed:`, String(e?.message ?? e).slice(0, 120));
                }
              }
            } catch (e) {
              log(`[${lg.slug}] box score ${d.why} match=${d.id} failed:`, String(e?.message ?? e).slice(0, 120));
            }
          }
        }
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
      await heartbeat(lg.slug, decision.state, { callsToday: total, cap: DEFAULT_CAP[lg.slug], live: decision.liveCount, ...(stats ? { statsCalls: statsCallsToday } : {}) }).catch(() => {});
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

log(`live-poller starting: pid=${process.pid} head=${HEAD} leagues=${LEAGUES.map((l) => l.slug).join(',')}`);

for (const lg of LEAGUES) {
  loop(lg).catch((e) => { console.error(`[${lg.slug}] loop died:`, e); process.exit(1); });
}
log('live-poller up:', LEAGUES.map((l) => l.slug).join(', '));
