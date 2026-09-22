/**
 * /api/cron/run-nudge — one reminder a day, to the people it is about.
 *
 * ONLY IF UNSET, AND ONLY IF THE LOCK IS INSIDE 24 HOURS. Both halves matter.
 * A reminder to somebody who has already set their nine is noise, and noise is
 * the one thing that makes a reminder ignorable forever; a reminder five days
 * out is about a deadline the reader cannot act on yet and will not remember.
 *
 * 15 00 * * * UTC = 8 AM Pacific, 11 AM Eastern. ONE FIRING A DAY, not hourly:
 * unlike a settle - which refuses until its gate opens and can therefore fire
 * harmlessly on the hour - a nudge that fires and finds work SENDS. An hourly
 * schedule would send the same reminder fifteen times, and the send-once claim
 * inside notifyPersonalized keys on the event id, which would make that
 * fifteen-hour silence look identical to a bug.
 *
 * ITS GATE IS THE ROUND'S LOCK, not the clock this route runs on. A round that
 * locks in six days gets nothing today; the same round gets exactly one nudge
 * on the morning it comes inside a day. A round with no lock at all - the
 * board could not be built - is skipped rather than guessed at.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { sql } from '@/lib/db';
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { withAdvisoryLock } from '@/lib/pollers/lock';
import { recordRun, recordDecision } from '@/lib/pollers/runRecorder';
import { maybeAlert } from '@/lib/pollers/alerts';
import { unsetForRound } from '@/lib/run/alerts';
import { pushEnabled } from '@/lib/push/apns';
import { notifyPersonalized } from '@/lib/push/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const SOURCE = 'run-nudge';

/** Hours from now inside which a lock is worth nudging about. */
export const NUDGE_WINDOW_HOURS = 24;

/**
 * PURE. Which open rounds are inside the window. Exported so the window rule
 * is testable without a database - the same posture dueOpenContests takes.
 */
export function dueForNudge(rounds = [], now = new Date()) {
  const t = new Date(now).getTime();
  const edge = t + NUDGE_WINDOW_HOURS * 3_600_000;
  return (rounds ?? []).filter((r) => {
    const lock = r?.locks_at == null ? NaN : new Date(r.locks_at).getTime();
    // A LOCK ALREADY PASSED IS NOT A NUDGE, it is a DNF - the round is gone
    // and telling somebody to hurry would be a lie about what is possible.
    return Number.isFinite(lock) && lock > t && lock <= edge;
  });
}

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });

  const outcome = await withAdvisoryLock(SOURCE, async () => recordRun(sql, {
    source: SOURCE,
    kind: 'nudge',
    run: async () => {
      const open = await sql`
        SELECT id, week, locks_at FROM contests
         WHERE game_type = 'run' AND sport = 'mlb' AND NOT settled
           AND opens_at <= now()
         ORDER BY week ASC`;
      const due = dueForNudge(open, new Date());
      const out = [];
      for (const r of due) {
        const recipients = await unsetForRound(r.id);
        if (!recipients.length || !pushEnabled()) {
          out.push({ contestId: r.id, week: r.week, unset: recipients.length, sent: false });
          continue;
        }
        // ONE EVENT ID PER ROUND PER DAY. notifyPersonalized's send-once claim
        // keys on it, so a retry inside the same day is a no-op and tomorrow's
        // nudge - for the people still unset - is a new key.
        const day = new Date().toISOString().slice(0, 10);
        const res = await notifyPersonalized(`run-reminder:${r.id}:${day}`, recipients).catch((e) => ({ error: String(e?.message ?? e) }));
        out.push({ contestId: r.id, week: r.week, unset: recipients.length, ...res });
      }
      return { open: open.length, due: due.length, results: out };
    },
  }));

  if (outcome.locked) {
    await recordDecision(sql, { source: SOURCE, kind: 'skipped-locked', summary: {} });
    return Response.json({ decision: 'skipped-locked' });
  }

  const res = outcome.result;
  const summary = res.summary ?? {};
  const errored = (summary.results ?? []).filter((r) => r.error);
  if (!res.ok || errored.length) {
    await maybeAlert(sql, {
      source: SOURCE,
      subject: '[run] nudge FAILED',
      body: [res.error ?? '', ...errored.map((e) => `contest ${e.contestId}: ${e.error}`)].filter(Boolean).join('\n'),
    });
  }
  return Response.json({ ok: res.ok, ...summary });
}
