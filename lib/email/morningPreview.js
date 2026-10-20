// lib/email/morningPreview.js - THE 6 AM PREVIEW (tue-4).
//
// Every day at 6:00 AM Pacific, ONE preview of that day's morning email goes to
// the owner's address ONLY (MORNING_PREVIEW_TO, default derik@sportsvyn.com),
// subject "[PREVIEW 8AM] <the real subject>". Same code and data as the real
// send - loadDay / loadReader / composeFor - rendered AS the owner's account
// (found by that address, never a typed user id), YOUR MOVE included.
//
// IT RUNS WHEN MORNING_EMAIL IS OFF: the switch guards mail to readers, and this
// goes to one owner address.
//
// IT NEVER TOUCHES THE REAL SEND'S LEDGER. Its rows are sync_runs source
// 'morning-preview' kind 'send', summary { day, to, userId, outcome }; the real
// run's alreadyMorning() reads source 'morning-email', so a preview can never
// make the 8 AM send skip anyone. ONCE PER DAY: the row is inserted only when no
// sent/sending row exists for the day (one statement), so a doubled firing sends
// one preview. A 'failed' row does not block a retry.
//
// TO IS GUARDED THREE WAYS: it must be in OWNER_ADDRESSES, a deliverable
// (non-placeholder) address, and the only recipient the send function is ever
// called with. Links are plain site links: a preview click is not a reader's.

import { sql } from '../db.js';
import { loadDay, loadReader, composeFor, etDay } from './morningSend.js';
import { OWNER_ADDRESSES } from './owners.js';
import { addressVerdict } from './testAccounts.js';

export const PREVIEW_SOURCE = 'morning-preview';
export const PREVIEW_PREFIX = '[PREVIEW 8AM] ';
export const DEFAULT_PREVIEW_TO = 'derik@sportsvyn.com';
const base = () => process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'https://sportsvyn.com';

export const previewTo = (env = process.env) => String(env?.MORNING_PREVIEW_TO || DEFAULT_PREVIEW_TO).trim().toLowerCase();

/**
 * ONE FIRING -> { day, decision, to?, userId? }. decision: 'sent' | 'already' |
 * 'refused-address' | 'no-account' | 'failed'.
 */
export async function runPreview({ now = new Date(), send, unsubscribeUrlFor, to = previewTo(), owners = OWNER_ADDRESSES } = {}) {
  const day = etDay(now);
  if (!owners.includes(to) || !addressVerdict(to).ok) return { day, decision: 'refused-address', to };
  const [acct] = await sql`SELECT id FROM users WHERE lower(email) = ${to} OR lower(COALESCE(contact_email, '')) = ${to} ORDER BY id LIMIT 1`;
  if (!acct) return { day, decision: 'no-account', to };
  const userId = Number(acct.id);

  const [row] = await sql`
    INSERT INTO sync_runs (source, kind, started_at, ok, summary)
    SELECT ${PREVIEW_SOURCE}, 'send', now(), true, ${JSON.stringify({ day, to, userId, outcome: 'sending' })}::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM sync_runs WHERE source = ${PREVIEW_SOURCE} AND kind = 'send' AND summary->>'day' = ${day} AND summary->>'to' = ${to}
                         AND summary->>'outcome' IN ('sending', 'sent'))
    RETURNING id`;
  if (!row) return { day, decision: 'already', to, userId };

  try {
    const dayData = await loadDay(day, { now });
    const reader = await loadReader(dayData, userId);
    const unsub = await unsubscribeUrlFor(userId);
    const mail = composeFor({ dayData, reader, unsubscribeUrl: unsub, player: true, link: (p) => `${base()}${p}` });
    const res = await send({ to, subject: `${PREVIEW_PREFIX}${mail.subject}`, html: mail.html, text: mail.text });
    if (res?.error) throw new Error(String(res.error?.message ?? res.error));
    await sql`UPDATE sync_runs SET finished_at = now(), ok = true,
                summary = ${JSON.stringify({ day, to, userId, outcome: 'sent', id: res?.data?.id ?? null })}::jsonb WHERE id = ${row.id}`;
    return { day, decision: 'sent', to, userId };
  } catch (e) {
    await sql`UPDATE sync_runs SET finished_at = now(), ok = false, error = ${String(e?.message ?? e).slice(0, 300)},
                summary = ${JSON.stringify({ day, to, userId, outcome: 'failed' })}::jsonb WHERE id = ${row.id}`;
    return { day, decision: 'failed', to, userId, error: String(e?.message ?? e).slice(0, 200) };
  }
}
