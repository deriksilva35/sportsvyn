/**
 * /api/cron/nfl-preseason - the preseason games poller.
 *
 * Fires every minute (vercel.json) and decides for itself whether to spend a
 * request. The decision lives in lib/pollers/preseasonWindow.js, which is pure
 * and clock-injectable, so the hard part is unit-tested rather than discovered
 * at 7pm on a Thursday.
 *
 *   hot        a preseason game today is between kickoff-15min and final+30min
 *              -> sync the DAY SLATE, one request, every 60s
 *   daily-sync nothing hot and the last sync is 12h+ old
 *              -> sync the day slate once, for schedule drift and late scores
 *   cold       nothing hot, synced recently -> no request, no row
 *   capped     the day's request count has hit DAILY_REQUEST_CAP -> refuse
 *
 * ONE REQUEST PER SWEEP, ALWAYS. The provider's /games takes a date, so a
 * 16-game Saturday costs exactly what a 3-game Thursday costs. Per-game polling
 * would multiply the budget by the slate size for no extra information.
 *
 * THE BUDGET IS LEDGERED, NOT ESTIMATED. Every sweep that spends a request
 * writes a sync_runs row carrying `requests`, and the next sweep counts today's
 * rows before deciding. That is the same shape the odds retries use, and it
 * means the cap is enforced against what actually happened rather than against
 * what the cadence implies - a redeploy loop or a manual run is visible to it.
 *
 * Runs under the same advisory lock as the other pollers: a slow sweep must not
 * overlap the next minute's tick and double-spend.
 *
 * Auth: Bearer ${CRON_SECRET}, same as every other cron.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { importApiSportsGames } from '@/lib/gridiron/apiSportsImport';
import { sweepDecision, slateDateEt, DAILY_REQUEST_CAP } from '@/lib/pollers/preseasonWindow';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const SOURCE = 'nfl-preseason';
const SEASON = 2026;

// Requests already spent today, read off the ledger. Counts the `requests` each
// run recorded rather than counting rows, so a sweep that ever spends more than
// one is accounted for honestly.
async function requestsToday() {
  const r = await sql`
    SELECT COALESCE(sum((summary->>'requests')::int), 0)::int AS n
      FROM sync_runs
     WHERE source = ${SOURCE}
       AND started_at >= date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York'`;
  return r[0]?.n ?? 0;
}

async function lastSyncAt() {
  const r = await sql`
    SELECT started_at FROM sync_runs
     WHERE source = ${SOURCE} AND kind IN ('hot', 'daily-sync') AND ok = true
     ORDER BY started_at DESC LIMIT 1`;
  return r[0]?.started_at ?? null;
}

// Today's preseason games, from OUR table. The window is decided against what
// we already know is scheduled, so a sweep costs a database read and nothing
// else until there is a reason to spend a request.
async function todaysPreseason(dateEt) {
  return sql`
    SELECT m.kickoff_at AS "kickoffAt", m.status
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_phase = 'PRE'
       AND (m.kickoff_at AT TIME ZONE 'America/New_York')::date = ${dateEt}::date`;
}

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const now = new Date();
  const dateEt = slateDateEt(now);

  const [games, spent, lastSync] = await Promise.all([
    todaysPreseason(dateEt), requestsToday(), lastSyncAt(),
  ]);

  const decision = sweepDecision({ games, now, requestsToday: spent, lastSyncAt: lastSync });

  if (!decision.poll) {
    // A refusal on budget is the one non-poll worth a row every time - it is the
    // signal that something is wrong. 'cold' and 'no-games' fire up to 1,440
    // times a day and would drown the table, so they stay silent.
    if (decision.reason === 'capped') {
      await recordDecision(sql, { source: SOURCE, kind: 'capped', ok: false, summary: { ...decision, dateEt } });
      await maybeAlert(sql, {
        source: SOURCE,
        subject: `[pollers] ${SOURCE} hit the daily request cap`,
        body: `date (ET): ${dateEt}\nrequests today: ${spent}\ncap: ${DAILY_REQUEST_CAP}\n\nThe poller is refusing to spend. Something is firing more often than the window intends.`,
      });
    }
    return Response.json({ dateEt, ...decision });
  }

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: decision.reason,
    run: () => importApiSportsGames({ leagueSlug: 'nfl', season: SEASON, date: dateEt }),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: { dateEt } });
    return Response.json({ dateEt, decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const unknown = res.summary?.unknownStatus ?? 0;
  const unresolved = res.summary?.unresolvedTeams ?? 0;
  if (!res.ok || unknown > 0 || unresolved > 0) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[pollers] ${SOURCE} ${!res.ok ? 'FAILED' : `unknownStatus=${unknown} unresolvedTeams=${unresolved}`}`,
      body: `date (ET): ${dateEt}\nkind: ${decision.reason}\n\n${res.error ?? JSON.stringify(res.summary)}`,
    });
  }

  return Response.json({
    dateEt, decision: decision.reason, ok: res.ok, id: res.id,
    requestsToday: spent + 1, cap: DAILY_REQUEST_CAP, summary: res.summary,
  });
}
