// lib/email/morningStats.js - THE MORNING EMAIL'S DAILY SUMMARY (tue-4), read-only.
//
// Per ET day: sent, delivered, opened, real clicks (scanner clicks removed, see
// lib/email/emailMetrics.js), and how many of that day's recipients PLAYED a
// game that day. "Played" = a Daily run completed (daily_board_runs), a contest
// entry created (Pick'em, Weekly, the per-game Draft, October, The Run ... all
// are contest_entries), or a draft started (drafts), within the ET day.
//
// Sources: our own ledger (sync_runs 'morning-email' sends, outcome 'sent'), the
// Resend webhook rows ('resend-webhook' delivered / opened / clicked) and our
// click ledger ('email-click', campaign morning-<day>). Opens and clicks only
// arrive once Resend's tracking is on for the sending domain and the webhook is
// subscribed to email.opened / email.clicked; until then those columns read 0.
// The preview's rows ('morning-preview') are never in here.

import { sql } from '../db.js';
import { easternLocalToUtc } from '../gridiron/ingest.js';
import { buildDaily } from './emailMetrics.js';

const addDays = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10); };

export async function morningDaily({ days = 14, today } = {}) {
  const sendRows = await sql`
    SELECT summary->>'day' AS day, (summary->>'userId')::int AS user_id, summary->>'id' AS message_id, started_at
      FROM sync_runs
     WHERE source = 'morning-email' AND kind = 'send' AND summary->>'outcome' = 'sent'
       AND started_at >= now() - make_interval(days => ${days + 1})`;
  const sends = sendRows.map((r) => ({ day: r.day, userId: r.user_id, messageId: r.message_id, sentAt: r.started_at }));
  const ids = sends.map((s) => s.messageId).filter(Boolean);
  const events = ids.length ? (await sql`
    SELECT kind, summary->>'messageId' AS message_id, COALESCE(summary->>'at', started_at::text) AS at
      FROM sync_runs
     WHERE source = 'resend-webhook' AND kind IN ('delivered', 'opened', 'clicked') AND summary->>'messageId' = ANY(${ids})`)
    .map((r) => ({ kind: r.kind, messageId: r.message_id, at: r.at })) : [];
  const ledgerClicks = (await sql`
    SELECT (summary->>'userId')::int AS user_id, summary->>'campaign' AS campaign, started_at AS at
      FROM sync_runs
     WHERE source = 'email-click' AND ok AND summary->>'campaign' LIKE 'morning-%'
       AND started_at >= now() - make_interval(days => ${days + 1})`)
    .map((r) => ({ userId: r.user_id, campaign: r.campaign, at: r.at }));

  const played = {};
  for (const day of [...new Set(sends.map((s) => s.day))]) {
    const start = await easternLocalToUtc(`${day} 00:00:00`);
    const end = await easternLocalToUtc(`${addDays(day, 1)} 00:00:00`);
    const users = [...new Set(sends.filter((s) => s.day === day).map((s) => s.userId))];
    const [{ n }] = await sql`
      SELECT count(DISTINCT u)::int n FROM (
        SELECT user_id u FROM daily_board_runs WHERE completed_at >= ${start}::timestamptz AND completed_at < ${end}::timestamptz AND user_id = ANY(${users})
        UNION SELECT user_id FROM contest_entries WHERE created_at >= ${start}::timestamptz AND created_at < ${end}::timestamptz AND user_id = ANY(${users})
        UNION SELECT user_id FROM drafts WHERE started_at >= ${start}::timestamptz AND started_at < ${end}::timestamptz AND user_id = ANY(${users})) x`;
    played[day] = n;
  }
  const rows = buildDaily({ sends, events, ledgerClicks, played });
  return today ? rows.filter((r) => r.day <= today) : rows;
}
