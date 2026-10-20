// lib/coins/resultsEmail.js - TUESDAY RESULTS BY EMAIL (Rules v0.1 s6; coins-2 B5).
//
// One mail per entrant per drawing: "You won ..." or "Not this week". Through
// the morning email's sender (lib/email/morningSend.js resendSend: house from
// and reply-to) with its parts: the signed one-click unsubscribe (RFC 8058),
// suppression first (lib/email/suppression.js), unsubscribed accounts never.
// Ledger: sync_runs source 'coins-email', kind 'send', summary { userId, week },
// written before the send, so a rerun mails nobody twice.

import { isHardBounced } from '../email/suppression.js';
import { resendSend } from '../email/morningSend.js';
import { unsubscribeUrlFor, unsubscribeHeaders, clickUrlFor } from '../auth/welcomeEmail.js';
// The morning email's palette, imported: an email cannot read a CSS token, and a
// second copy of the hexes would be a second place to change them.
import { INK, MUTED, LINE, LIME } from '../emails/morning.js';

export const SOURCE = 'coins-email';
const base = () => process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'https://sportsvyn.com';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const FOOTER = "You're getting this because you had coins in The Drum this week.";

/** PURE: the mail for one entrant. */
export function resultsMail({ ordinal, prize = null, coins = 0, nextOrdinal, href, unsubscribe, postal = null }) {
  const subject = prize ? `You won ${prize.startsWith('a ') ? prize : `a ${prize}`} in The Drum` : `Week ${ordinal} results: not this week`;
  const lead = prize
    ? `A coin of yours won ${prize.startsWith('a ') ? prize : `a ${prize}`} in the week ${ordinal} drawing. Open The Drum to confirm your details and claim it within 14 days.`
    : `Your ${coins} coin${coins === 1 ? '' : 's'} went in for week ${ordinal}, and no prize came up this time. Week ${nextOrdinal} is open now: every game you play fills your coin meter.`;
  const cta = prize ? 'Claim your prize' : 'See the winners';
  const html = `<!doctype html><html lang="en"><body style="margin:0;padding:24px 16px;background:white;font-family:Rubik,Arial,sans-serif;color:${INK};">
<div style="max-width:520px;margin:0 auto;">
<div style="font-size:11px;letter-spacing:0.12em;padding-bottom:8px;">THE DRUM - WEEK ${esc(ordinal)}</div>
<div style="font-size:22px;font-weight:700;line-height:1.25;padding-bottom:12px;">${esc(prize ? 'You won.' : 'Not this week.')}</div>
<div style="font-size:16px;line-height:1.5;padding-bottom:18px;">${esc(lead)}</div>
<a href="${esc(href)}" style="display:inline-block;background:${LIME};color:${INK};text-decoration:none;padding:14px 22px;border-radius:99px;font-weight:700;">${esc(cta)}</a>
<div style="font-size:12px;line-height:1.5;color:${MUTED};padding-top:28px;border-top:1px solid ${LINE};margin-top:28px;">${esc(FOOTER)}<br><a href="${esc(unsubscribe)}" style="color:${MUTED};">Unsubscribe from all email</a>${postal ? `<br>${esc(postal)}` : ''}</div>
</div></body></html>`;
  const text = [`THE DRUM - WEEK ${ordinal}`, prize ? 'You won.' : 'Not this week.', lead, `${cta}: ${href}`, '', '---', FOOTER, `Unsubscribe from all email: ${unsubscribe}`, ...(postal ? [postal] : [])].join('\n');
  return { subject, html, text };
}

/** The `send` runClose takes. -> { sent, skipped, suppressed, failed }. */
export function makeResultsSender({ deliver = resendSend } = {}) {
  return async ({ week, won, coins, nextOrdinal, db }) => {
    const ids = [...coins.keys()];
    const users = ids.length ? await db`
      SELECT id, COALESCE(contact_email, email) AS email FROM users
       WHERE id = ANY(${ids}) AND email_opted_out_at IS NULL AND COALESCE(contact_email, email) IS NOT NULL` : [];
    const out = { sent: 0, skipped: 0, suppressed: 0, failed: 0 };
    for (const u of users) {
      if (await isHardBounced(db, u.email)) { out.suppressed += 1; continue; }
      const claim = await db`
        INSERT INTO sync_runs (source, kind, started_at, ok, summary)
        SELECT ${SOURCE}, 'send', now(), true, ${JSON.stringify({ userId: Number(u.id), week: week.id, outcome: 'sending' })}::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM sync_runs WHERE source = ${SOURCE} AND kind = 'send'
                             AND (summary->>'userId')::int = ${Number(u.id)} AND (summary->>'week')::int = ${week.id})
        RETURNING id`;
      if (!claim.length) { out.skipped += 1; continue; }
      try {
        const unsub = await unsubscribeUrlFor(u.id);
        const prize = won.get(Number(u.id)) ?? null;
        const href = clickUrlFor({ campaign: `coins-${week.id}`, userId: u.id, to: `${base()}/coins/results/${week.id}` });
        const mail = resultsMail({ ordinal: week.ordinal, prize, coins: coins.get(Number(u.id)), nextOrdinal, href, unsubscribe: unsub, postal: process.env.EMAIL_POSTAL_ADDRESS || null });
        const res = await deliver({ to: u.email, subject: mail.subject, html: mail.html, text: mail.text, headers: unsubscribeHeaders(unsub) });
        if (res?.error) throw new Error(String(res.error?.message ?? res.error));
        await db`UPDATE sync_runs SET finished_at = now(), summary = ${JSON.stringify({ userId: Number(u.id), week: week.id, outcome: 'sent', won: Boolean(prize), id: res?.data?.id ?? null })}::jsonb WHERE id = ${claim[0].id}`;
        out.sent += 1;
      } catch (e) {
        await db`UPDATE sync_runs SET finished_at = now(), ok = false, error = ${String(e?.message ?? e).slice(0, 300)},
                   summary = ${JSON.stringify({ userId: Number(u.id), week: week.id, outcome: 'failed' })}::jsonb WHERE id = ${claim[0].id}`;
        out.failed += 1;
      }
    }
    return out;
  };
}
