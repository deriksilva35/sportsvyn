/**
 * /api/cron/daily-puzzle — create the Daily's board for today and tomorrow ET.
 *
 * THE PREMISE: the answers are public record. A board with Peyton Manning and
 * Todd Gurley on it is 2015-2016 to anyone who follows football, and the box
 * score is a search away. THE CLOCK IS THE GAME — three minutes, enforced
 * server-side. Nothing here is hidden in the belief that hiding it stops a
 * determined person; it is hidden so the puzzle stays honest for the people
 * playing it straight.
 *
 * TWO DAYS AHEAD, NOT ONE. A creation tick that only made "today ET" would
 * leave the minutes after midnight with no puzzle, because the tick runs at
 * 09:13Z and midnight ET is 04:00Z or 05:00Z depending on the season. Making
 * tomorrow as well means the row is always in place before the day turns,
 * whatever DST is doing.
 *
 * TOMORROW'S ROW IS A BUFFER, NOT A PREVIEW. It exists ~19 hours before anyone
 * can play it, and NOTHING READS IT BEFORE opens_at - no route serves a board
 * whose day has not started, and the scores and teams never leave the server
 * pre-close in any case. The row is there so the day can turn without waiting
 * on a cron, and for no other reason.
 *
 * IDEMPOTENT. ON CONFLICT DO NOTHING on the date primary key: a re-tick, a
 * redeploy, or a manual run cannot produce a second board for a day someone is
 * already playing. That is also why the generator is seeded rather than random.
 *
 * ET BOUNDARIES ARE COMPUTED IN POSTGRES. `AT TIME ZONE 'America/New_York'` on
 * a stored timestamp is the house pattern for day bucketing (see
 * nfl-preseason/route.js); it is NOT the provider-datetime conversion that
 * ingest.js reserves for easternLocalToUtc(). Nothing here parses a provider
 * string.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { ensurePuzzleDay, resumeIndex, careerIndex } from '@/lib/daily/create';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const SOURCE = 'daily-puzzle';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const days = await sql`
    SELECT to_char((now() AT TIME ZONE 'America/New_York')::date, 'YYYY-MM-DD') AS today,
           to_char((now() AT TIME ZONE 'America/New_York')::date + 1, 'YYYY-MM-DD') AS tomorrow`;
  const targets = [days[0].today, days[0].tomorrow];

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'create',
    run: async () => {
      // BUILD THE TWO SHARED INDEXES ONCE, AND ONLY IF A DAY ACTUALLY NEEDS
      // BUILDING. The resume index parses a 7MB CSV and the career index
      // aggregates the whole corpus; ensurePuzzleDay returns early for a day
      // that already exists, so on the ordinary tick - where both rows are
      // already there - neither is worth paying for. This existence probe is
      // an optimisation only: ensurePuzzleDay re-checks under ON CONFLICT DO
      // NOTHING, so the race guard does not rest on what we read here.
      const have = new Set((await sql`
        SELECT to_char(puzzle_date, 'YYYY-MM-DD') AS d
          FROM puzzle_days WHERE puzzle_date = ANY(${targets}::date[])`).map((r) => r.d));
      const shared = targets.some((t) => !have.has(t))
        ? { resumeByPlayer: await resumeIndex(), careerByPlayer: await careerIndex() }
        : {};

      const made = [];
      for (const d of targets) made.push(await ensurePuzzleDay(d, shared));
      return {
        targets,
        created: made.filter((m) => m.created).map((m) => m.puzzle_date),
        existing: made.filter((m) => !m.created && !m.error).length,
        failed: made.filter((m) => m.error).map((m) => `${m.puzzle_date}: ${m.error}`),
      };
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: { targets } });
    return Response.json({ decision: 'skipped-locked', targets });
  }

  const res = outcome.result;
  const failed = res.summary?.failed ?? [];
  if (!res.ok || failed.length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[daily] puzzle creation ${!res.ok ? 'FAILED' : 'incomplete'}`,
      body: `${res.error ?? ''}\n${failed.join('\n')}`,
    });
  }
  return Response.json({ ok: res.ok, ...res.summary });
}
