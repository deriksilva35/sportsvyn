/**
 * /api/cron/cfb-25-reminder-late - the 15:30Z Monday retry of cfb-25-reminder.
 *
 * Two crons cannot share a path (the vercel.json guard), and the reminder needs
 * two ticks: 13:00Z asks, and 15:30Z catches an AP week that cfb-rankings
 * (14:15Z) imported after the first. Same job, same once-per-week marker.
 */
import { cronAuthorized } from '@/lib/pollers/cronAuth';
import { runReminderCron } from '@/lib/cfb/reminderCron';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  if (!cronAuthorized(request)) return new Response('Unauthorized', { status: 401 });
  return runReminderCron();
}
