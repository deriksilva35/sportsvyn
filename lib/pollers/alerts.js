/**
 * lib/pollers/alerts.js — failure alerting for the pollers.
 *
 * maybeAlert emails Derik (plain text, via the existing Resend client) when a run
 * fails OR reports unknownStatus > 0 (a fail-loud mapStatus miss — exactly what
 * we want to hear about). Rate-limited to one alert per source per
 * ALERT_WINDOW_HOURS via an 'alert' marker row in sync_runs. The marker is
 * written BEFORE sending, so a Resend outage can't turn into a per-tick retry
 * storm — we prefer one dropped alert over spamming.
 */

import { resend, EMAIL_FROM, EMAIL_REPLY_TO } from '../resend.js';

export const ALERT_WINDOW_HOURS = 6;
export const ALERT_EMAIL = 'deriksilva@gmail.com';

export async function maybeAlert(sql, { source, subject, body }) {
  const recent = await sql`
    SELECT 1 FROM sync_runs
     WHERE source = ${source} AND kind = 'alert'
       AND started_at > now() - make_interval(hours => ${ALERT_WINDOW_HOURS})
     LIMIT 1`;
  if (recent.length) return { sent: false, reason: 'rate_limited' };

  // Burn the window first (anti-spam), then try to send.
  await sql`
    INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
    VALUES (${source}, 'alert', now(), now(), true, ${JSON.stringify({ subject })}::jsonb)`;
  try {
    await resend.emails.send({
      from: EMAIL_FROM,
      to: ALERT_EMAIL,
      replyTo: EMAIL_REPLY_TO,
      subject,
      text: body,
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: 'send_failed', error: String(e?.message ?? e).slice(0, 200) };
  }
}
