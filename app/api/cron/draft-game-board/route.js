/**
 * /api/cron/draft-game-board - create the per-game Draft boards (thu-3 S1).
 *
 * HOURLY AT :33, IDEMPOTENT. lib/draftGame/create.js ensureGameBoards makes a board for
 * every NFL game whose open (72 h before kickoff) has arrived and that has not
 * kicked, one per game against migration 136's UNIQUE (game_type, match_id),
 * and moves any open board's lock to its game's current kickoff. Most fires
 * create nothing; a missed hour is made up by the next.
 *
 * OFF UNLESS DRAFT_GAME_BOARDS=on (fri-1): until S2 can settle a board, PROD
 * runs with the switch off and every fire records { disabled: true }.
 *
 * Every fire lands a recordRun row (created / refused / raced / locks moved) in
 * sync_runs, and a run that throws alerts through maybeAlert - the
 * pickem-board pattern.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { ensureGameBoards } from '@/lib/draftGame/create';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const SOURCE = 'draft-game-board';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'create',
    run: async () => ensureGameBoards(),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[draft-game] board creation FAILED',
      body: String(res.error ?? 'unknown error'),
    });
  }
  return Response.json({ ok: res.ok, ...res.summary });
}
