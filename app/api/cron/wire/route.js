// /api/cron/wire — the wire's only writer.
//
// EVERY LANE IN ONE TICK, and every lane caught on its own. A club feed that
// stops answering must not cost the line moves; an expired provider key must
// not cost the finals. Each source reports its own count and its own failure,
// and the run is ok only if the tick itself completed.
//
// PER-TICK COST, stated so a regression is visible:
//   32 club feed fetches (one per NFL club, eight at a time)
//    1 injuries call (2 pages max, 100 per page)
//   ~6 database reads for the data-native lanes
//    1 retention sweep
// At */15 that is ~3,168 club fetches and 96 provider calls a day.
// (The stats vendor is named in lib/wire/injuries.js, never in user-facing
//  source - see lib/legal.test.mjs.)
//
// STAGGERED OFF THE :00 CROWD. Nine other jobs already fire on the hour; this
// runs at 7, 22, 37, 52 so a slow club site cannot queue behind them.

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { recordRun } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { emit, sweep } from '@/lib/wire/emit';
import { lineMoves } from '@/lib/wire/lines';
import { contestEvents } from '@/lib/wire/contests';
import { finals } from '@/lib/wire/finals';
import { cfbMilestones } from '@/lib/wire/milestones';
import { apMovement, powerMovement } from '@/lib/wire/polls';
import { fetchInjuries, toRows as injuryRows } from '@/lib/wire/injuries';
import { pollFeeds } from '@/lib/wire/rss';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const WINDOW_MIN = 15;

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  // THE LEDGER TIMES THE TICK, NOT A WRAPPER. The first version ran every lane
  // and THEN called recordRun with a no-op, so started_at and finished_at were
  // six milliseconds apart for work that takes about four seconds. ok, summary
  // and error were right; the timing was meaningless. The work goes inside.
  const out = await recordRun(sql, { source: 'wire', kind: 'wire', run: () => tick() });
  return NextResponse.json(out?.summary ?? out ?? { ok: false });
}

async function tick() {
  const started = new Date();
  const per = [];
  const errors = [];
  const run = async (name, fn) => {
    try {
      const rows = await fn();
      const written = await emit(rows);
      per.push({ lane: name, found: rows.length, written });
    } catch (e) {
      errors.push(`${name}: ${String(e?.message ?? e).slice(0, 140)}`);
      per.push({ lane: name, found: 0, written: 0, error: true });
    }
  };

  const season = resolveSeasonYear(started);

  // ---- lane 1: our own numbers -------------------------------------------
  await run('line', () => lineMoves({ now: started }));
  await run('contest', () => contestEvents({ now: started, windowMin: WINDOW_MIN }));
  await run('final', () => finals({ now: started, windowMin: WINDOW_MIN + 5 }));
  await run('poll-ap', async () => {
    const { currentApWeek, latestPollSeason, AP_POLL } = await import('@/lib/cfb/rankings');
    const s = await latestPollSeason(AP_POLL);
    const w = s ? await currentApWeek(s) : null;
    return apMovement({ season: s, week: w });
  });
  await run('poll-power', () => powerMovement({ season }));
  await run('milestone', async () => {
    const [wk] = await sql`
      SELECT week FROM matches m JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = 'cfb' AND m.season_year = ${season} AND m.season_phase = 'REG'
         AND m.status = 'final'
       ORDER BY m.kickoff_at DESC LIMIT 1`;
    return wk ? cfbMilestones({ season, week: wk.week }) : [];
  });
  // RECORD FLIPS ARE NOT POLLED. They are emitted by the standings sync at
  // write time, which holds the before and the after; there is nothing here.

  // ---- lane 2: other people's ---------------------------------------------
  await run('injury', async () => {
    const [nfl] = await sql`SELECT id FROM leagues WHERE slug = 'nfl'`;
    const teams = await sql`
      SELECT id, abbreviation FROM teams WHERE league_id = ${nfl?.id ?? -1} AND abbreviation IS NOT NULL`;
    const byAbbr = new Map(teams.map((t) => [t.abbreviation, t.id]));
    const items = await fetchInjuries({ maxPages: 2 });
    return injuryRows(items, { leagueId: nfl?.id ?? null, teamByAbbr: byAbbr });
  });

  // EIGHT AT A TIME. Thirty-two sequential fetches do not fit in the tick -
  // the first dry run ran out of time part-way through, and maxDuration here
  // is 60 seconds.
  const feeds = await sql`SELECT * FROM news_feeds WHERE is_active ORDER BY id`.catch(() => []);
  const { rows: clubRows, down: clubDown } = await pollFeeds(feeds, {
    onFeed: async (f, err) => {
      if (err) {
        await sql`UPDATE news_feeds SET last_polled_at = now(),
                    last_error = ${String(err?.message ?? err).slice(0, 200)} WHERE id = ${f.id}`;
      } else {
        await sql`UPDATE news_feeds SET last_polled_at = now(), last_ok_at = now(),
                    last_error = NULL WHERE id = ${f.id}`;
      }
    },
  });
  const clubWritten = await emit(clubRows);
  per.push({ lane: 'club', feeds: feeds.length, found: clubRows.length, written: clubWritten, down: clubDown.length });

  // ---- the take, a rider on the same tick ---------------------------------
  // BOUNDED PER TICK. Eight items is a handful of model calls a quarter hour,
  // and the wire is worth more with a few checked takes than with many
  // unchecked ones. A rejection is ledgered with its reason and the item keeps
  // its headline, which is a complete item on its own.
  // BOUNDED BY THE CLOCK, NOT JUST BY COUNT. Eight model calls at a few
  // seconds each ran the whole tick past its limit: the 15:52 run was killed
  // with finished_at null, so the ledger could not even record why. The rider
  // now stops when the tick's budget is spent and reports how many it skipped,
  // which turns a dead tick into a short one.
  const TAKE_BUDGET_MS = 25000;
  const takeDeadline = Date.now() + TAKE_BUDGET_MS;
  const takes = { tried: 0, wrote: 0, skipped: 0, rejected: {} };
  try {
    const { takeCandidates, buildEnvelope, generateTake, writeTake, takePrompt } = await import('@/lib/wire/take');
    const prompt = await takePrompt();
    for (const c of await takeCandidates({ limit: 4 })) {
      if (Date.now() > takeDeadline) { takes.skipped += 1; continue; }
      const env = await buildEnvelope(c, { season });
      if (!env) { takes.rejected.empty_envelope = (takes.rejected.empty_envelope ?? 0) + 1; continue; }
      takes.tried += 1;
      const r = await generateTake(c, env, { prompt });
      if (r.ok) { await writeTake(c.id, r.text); takes.wrote += 1; }
      else { takes.rejected[r.reason] = (takes.rejected[r.reason] ?? 0) + 1; }
    }
  } catch (e) {
    errors.push(`take: ${String(e?.message ?? e).slice(0, 120)}`);
  }
  per.push({ lane: 'take', ...takes });

  const swept = await sweep().catch(() => 0);
  const summary = { per, swept, downFeeds: clubDown, errors };
  const ok = errors.length === 0;
  summary.ok = ok;

  // A FEED SHAPE THAT STOPPED PARSING IS THE ALARM WORTH RAISING. One club
  // going quiet is ordinary; a third of them at once means the pattern moved.
  if (!ok || clubDown.length >= Math.max(3, Math.ceil(feeds.length / 3))) {
    await maybeAlert(sql, {
      source: 'wire',
      subject: 'wire tick degraded',
      body: `errors=${errors.length} downFeeds=${clubDown.length}/${feeds.length}`,
      detail: errors.join(' | ') || clubDown.join(', '),
    }).catch(() => {});
  }

  // A LANE FAILING IS A FAILED TICK. recordRun marks the row ok only when run()
  // returns, so throwing here is what makes the ledger tell the truth - and the
  // summary is attached either way by the catch above.
  if (!ok) { const e = new Error(errors.join(' | ')); e.summary = summary; throw e; }
  return summary;
}
