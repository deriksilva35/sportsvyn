/**
 * /api/cron/data-retention - odds price history 14 days, job logs 30 days
 * (sun-16 item E).
 *
 * DRY-RUNS UNLESS RETENTION_APPLY=on. Without the flag it counts what each
 * rule would delete (kind 'dry-run'); with it, it deletes (kind 'apply'). The
 * rules - what is kept forever and which reader needs it - are in
 * lib/ops/dataRetention.js; the same counts, read-only, are
 * scripts/retention-dry-run.mjs.
 *
 * Deletes in statements of at most 20k rows, under a per-run row cap and a
 * 240 s budget inside maxDuration, so it never holds a long lock or a big
 * transaction; a run that stops early leaves a cursor the next one resumes.
 *
 * 43 9 * * * UTC - daily, an off minute in the quietest hour (05:43 ET, no
 * game live anywhere we cover).
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { runRetention, retentionMode } from '@/lib/ops/dataRetention';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const SOURCE = 'data-retention';

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const mode = retentionMode(process.env);
  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: mode,
    run: () => runRetention({ sql, mode, now: new Date() }),
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: { mode } });
    return Response.json({ decision: 'skipped-locked', mode });
  }

  const res = outcome.result;
  if (!res.ok) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: `[pollers] ${SOURCE} FAILED (${mode})`,
      body: `source: ${SOURCE}\nmode: ${mode}\n\n${res.error}`,
    });
  }
  return Response.json({ ok: res.ok, id: res.id, ...(res.summary ?? {}) });
}
