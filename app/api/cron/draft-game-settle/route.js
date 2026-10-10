/**
 * /api/cron/draft-game-settle - settle per-game Draft boards (fri-1 S2).
 *
 * EVERY 10 MINUTES. lib/draftGame/settle.js settleDueGameBoards takes every
 * unsettled 'draft_game' board whose game has kicked and settles the ones that
 * are due: final, box in, SETTLE_AFTER_HOURS past kickoff - or called off,
 * which settles void. The rest wait and the summary says why (not_final /
 * grace / box_not_in). Idempotent: a settled board is never touched again.
 *
 * NOT behind DRAFT_GAME_BOARDS: the switch stops new boards; a board that
 * exists always gets settled.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { settleDueGameBoards } from '@/lib/draftGame/settle';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const SOURCE = 'draft-game-settle';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'settle',
    run: async () => settleDueGameBoards(),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[draft-game] settle FAILED',
      body: String(res.error ?? 'unknown error'),
    });
  }
  return Response.json({ ok: res.ok, ...res.summary });
}
