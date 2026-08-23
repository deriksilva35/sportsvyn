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
 * ONE REQUEST PER SWEEP FOR THE SCORES, ALWAYS. The provider's /games takes a
 * date, so a 16-game Saturday costs exactly what a 3-game Thursday costs.
 * Per-game polling would multiply the budget by the slate size for no extra
 * information.
 *
 * GAME DETAIL IS THE EXCEPTION, and it is priced as one. The scoring summary
 * and player lines behind /nfl/game/[slug] are per-game and two requests each,
 * so they run on their own ten-minute cadence (detailTargets), at most four
 * games a sweep, and only for games that are actually live - plus exactly one
 * fetch when a game flips to final, which is the version that stays on the page.
 * Sat 22 Aug prices at 1,328 requests all in; see DAILY_REQUEST_CAP.
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
import { sweepDecision, slateDateEt, pollSlateDatesEt, slateDatesForProvider, providerDatesForGames, detailTargets, DAILY_REQUEST_CAP } from '@/lib/pollers/preseasonWindow';
import { fetchGameDetail } from '@/lib/gridiron/gameDetail';

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
    SELECT m.id, m.kickoff_at AS "kickoffAt", m.status,
           m.metadata->'detail'->>'at'                       AS "detailAt",
           (m.metadata->'detail'->>'final')::boolean         AS "detailFinal",
           m.metadata->'detail'->>'final_seen_at'            AS "finalSeenAt"
      FROM matches m JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_phase = 'PRE'
       AND (m.kickoff_at AT TIME ZONE 'America/New_York')::date = ${dateEt}::date`;
}

/**
 * The per-game detail pass. Runs AFTER the score sweep, on the freshly-written
 * statuses, so a game that flipped to final this minute gets its final fetch
 * this minute rather than next.
 *
 * Every fetch is individually guarded. fetchGameDetail already swallows a
 * per-endpoint failure into its summary, so this catch is for the row read
 * around it - and either way one game's bad night must not cost the other nine
 * theirs, nor abort the sweep that already spent its score request.
 */
async function detailPass({ dates, budgetLeft }) {
  if (budgetLeft <= 0) return { requests: 0, games: 0, skipped: 'no-budget' };
  // Same sports-day union as the score sweep: a straggler's post-final detail
  // fetch must not be orphaned by the calendar rolling under it.
  const games = (await Promise.all(dates.map((d) => todaysPreseason(d)))).flat();
  const targets = detailTargets({ games, now: new Date() });
  let requests = 0;
  const done = [];
  for (const t of targets) {
    // Two requests a game. Stop before overrunning the cap rather than after.
    if (requests + 2 > budgetLeft) break;
    try {
      const res = await fetchGameDetail(t.id);
      requests += res.requests ?? 0;
      done.push({ id: t.id, final: t.final, events: res.events, lines: res.playerLines, errors: res.errors });
    } catch (err) {
      console.error(`nfl-preseason: detail fetch failed for match ${t.id} -`, err);
      done.push({ id: t.id, final: t.final, error: String(err?.message ?? err) });
    }
  }
  return { requests, games: done.length, targets: targets.length, done };
}

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const now = new Date();
  // TWO CLOCKS, DELIBERATELY. dateEt keys OUR rows - matches are grouped by ET
  // day, the same way /scores groups them. providerDates keys the PROVIDER's
  // slate, which is indexed by UTC date, and one ET evening spans two of them.
  // Feeding the ET day to both is the defect that made the 8pm and 9pm ET
  // kickoffs invisible on 13 Aug.
  const dateEt = slateDateEt(now);

  // THE SPORTS-DAY LAW: before 06:00 ET the prior date's games ride along, so
  // a Saturday straggler still live past midnight keeps its poller (the
  // 23 Aug freeze: DAL@ARI in Q4, window rolled, board froze at 24-6).
  const slateDates = pollSlateDatesEt(now);
  const [gamesByDate, spent, lastSync] = await Promise.all([
    Promise.all(slateDates.map((d) => todaysPreseason(d))), requestsToday(), lastSyncAt(),
  ]);
  const games = gamesByDate.flat();

  const decision = sweepDecision({ games, now, requestsToday: spent, lastSyncAt: lastSync });

  // DATES DERIVED FROM THE KICKOFFS WE ALREADY HAVE, not guessed from the
  // calendar. The blind two-date sweep asked for the ET day and the next one on
  // every tick, which is one wasted request per sweep on a normal evening and
  // the difference between fitting the cap and blowing it on a ten-game
  // Saturday. providerDatesForGames usually returns ONE date, and returns two
  // only when the slate genuinely straddles midnight UTC.
  //
  // THE BLIND SWEEP IS THE FALLBACK, not the default: if we somehow have no
  // kickoffs in window but are polling anyway, asking for both dates is better
  // than asking for none and going dark. sweepDecision refuses on 'no-games'
  // before this matters, so in practice the fallback is unreachable - it is
  // here so a future caller that skips that check cannot go blind.
  const derived = providerDatesForGames({ games, now });
  const providerDates = derived.length ? derived : slateDatesForProvider(now);

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
    run: () => importApiSportsGames({ leagueSlug: 'nfl', season: SEASON, date: providerDates }),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: { dateEt } });
    return Response.json({ dateEt, decision: 'skipped-locked' });
  }

  const res = outcome.result;

  // The detail pass rides the same invocation and is ledgered into the same
  // day's count, because it draws on the same budget.
  const detail = await detailPass({
    dates: slateDates,
    budgetLeft: DAILY_REQUEST_CAP - (spent + 1),
  });
  if (detail.requests > 0) {
    await recordDecision(sql, {
      source: SOURCE, kind: 'detail', ok: true,
      summary: { dateEt, requests: detail.requests, games: detail.games, done: detail.done },
    });
  }

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
    dateEt, providerDates, decision: decision.reason, ok: res.ok, id: res.id,
    requestsToday: spent + 1 + detail.requests, cap: DAILY_REQUEST_CAP,
    summary: res.summary, detail,
  });
}
