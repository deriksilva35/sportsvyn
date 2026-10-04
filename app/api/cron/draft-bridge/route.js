/**
 * /api/cron/draft-bridge - store every locked Draft contest's rosters (lib/draft/lockBridge.js).
 *
 * Hourly at :45, every day. Most firings find every roster already stored and
 * write nothing; the one that follows Thursday's lock does the week's work, and
 * any room that finishes late is picked up an hour later instead of on Tuesday.
 *
 * IT ALSO FREEZES THE WEEK'S BOARD (ruling sat-6): the first firing after a
 * Draft contest's opens_at freezes the one board every room of that contest
 * drafts, if the first room start has not already (lib/draft/lockBridge.js
 * freezeOpenDraftBoards). A board failure alerts like a bridge failure.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { bridgeLockedDrafts, freezeOpenDraftBoards } from '@/lib/draft/lockBridge';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'draft-bridge';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'bridge',
    run: async () => {
      const now = new Date();
      const bridged = await bridgeLockedDrafts({ now });
      const boards = await freezeOpenDraftBoards({ now });
      return { ...bridged, boards };
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const summary = res.summary ?? {};
  const errored = [
    ...(summary.results ?? []).filter((r) => r.error),
    ...(summary.boards?.results ?? []).filter((r) => r.error || r.ok === false)
      .map((r) => ({ contestId: r.contestId, error: `board: ${r.error ?? r.reason}` })),
  ];
  if (!res.ok || errored.length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[draft] roster bridge FAILED',
      body: [res.error ?? '', ...errored.map((e) => `contest ${e.contestId}: ${e.error}`)].filter(Boolean).join('\n'),
    });
  }
  return Response.json({ ok: res.ok, ...summary });
}
