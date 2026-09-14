/**
 * /api/cron/house-entries - the four house personas file their entries.
 *
 * HOURLY, AND IDEMPOTENT AT EVERY LEVEL. Every writer underneath is already
 * idempotent by a unique constraint, so a tick that has nothing to do costs
 * four reads and writes nothing. That is what buys the schedule: one cron that
 * runs often and does nothing, rather than four that each have to be right
 * about when their board appears.
 *
 * IT READS THE BOARDS, IT DOES NOT MAKE THEM. daily-puzzle, pickem-board and
 * weekly-board own creation; this one only ever finds what they made. A board
 * that does not exist yet is a tick with one fewer game in its summary, never
 * an error.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { runHouseTick } from '@/lib/house/run';
import { HOMER_TEAMS } from '@/lib/house/personas';
import { currentPickemBoard } from '@/lib/pickem/sequence';
import { currentContest as currentWeeklyContest } from '@/lib/weekly/entries';
import { currentDraftContest } from '@/lib/draft/contest';
import { getSpreadHome } from '@/lib/gridiron/oddsReader';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'house-entries';

/** Today's open Daily edition, or null. */
async function openDailyBoard(now) {
  const [b] = await sql`
    SELECT * FROM daily_boards
     WHERE opens_at <= ${now.toISOString()} AND closes_at > ${now.toISOString()}
     ORDER BY edition_date DESC LIMIT 1`;
  return b ?? null;
}

/** The Homer's team ids, resolved from abbreviations once per tick. */
async function homerTeamIds() {
  const rows = await sql`
    SELECT t.id FROM teams t JOIN leagues l ON l.id = t.league_id
     WHERE l.slug = 'nfl' AND t.abbreviation = ANY(${[...HOMER_TEAMS]})`;
  return rows.map((r) => Number(r.id));
}

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  const now = new Date();

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'file',
    run: async () => {
      const [daily, pickem, weekly, draft, homerIds] = await Promise.all([
        openDailyBoard(now).catch(() => null),
        currentPickemBoard({ now }).catch(() => null),
        currentWeeklyContest({ now }).catch(() => null),
        currentDraftContest({ now }).catch(() => null),
        homerTeamIds().catch(() => []),
      ]);
      const spreads = pickem
        ? await getSpreadHome((pickem.board ?? []).map((g) => g.match_id)).catch(() => new Map())
        : new Map();

      const summary = await runHouseTick(sql, {
        now,
        openDailyBoard: daily,
        pickemContest: pickem && !pickem.settled ? pickem : null,
        weeklyContest: weekly && !weekly.settled ? weekly : null,
        draftContest: draft && !draft.settled ? draft : null,
        spreads,
        homerTeamIds: homerIds,
      });
      return { ok: true, summary };
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }
  const res = outcome.result;
  return Response.json({ ok: res.ok, ...(res.summary ?? {}) });
}
