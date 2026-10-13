/**
 * /api/cron/cfb-25-reminder - "CFB 25 due - week N" (mon-9).
 *
 * Mondays 13:00Z, and again 15:30Z. The first is the ask; the second exists
 * because the AP week is imported by /api/cron/cfb-rankings at 14:15Z, so at
 * 13:00Z the new week may not be in the database yet (the job then says
 * nothing and the later tick picks it up). Either way: ONE email per AP week
 * (a sync_runs marker), and none at all once content/power/cfb-2026-w<N>.md
 * has landed. Logic and the table: lib/cfb/editorReminder.js; dry run:
 * scripts/cfb25-reminder.mjs.
 *
 * Auth: Bearer ${CRON_SECRET}.
 */

import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { runReminderCron } from '@/lib/cfb/reminderCron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  return runReminderCron();
}
