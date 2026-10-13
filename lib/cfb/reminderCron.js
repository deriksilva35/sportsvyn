// lib/cfb/reminderCron.js - the body both reminder cron routes run (after
// their own auth gate). Server-only: it imports the real mailer.
import { sql } from '@/lib/db';
import { resend, EMAIL_FROM, EMAIL_REPLY_TO } from '@/lib/resend';
import { currentApRanks } from '@/lib/cfb/rankings';
import { runReminder } from '@/lib/cfb/editorReminder';

const send = ({ to, subject, body }) => resend.emails.send({
  from: EMAIL_FROM, to, replyTo: EMAIL_REPLY_TO, subject, text: body,
});

export async function runReminderCron() {
  const out = await runReminder({
    sql, send, now: new Date(),
    readAp: async () => {
      const { season, week } = await currentApRanks();
      return { season, week };
    },
  });
  return Response.json({ decision: out.decision, season: out.season ?? null, week: out.week ?? null });
}
