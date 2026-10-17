// lib/email/suppression.js - HARD-BOUNCED ADDRESSES ARE NEVER MAILED AGAIN (fri-3).
//
// The Resend webhook (app/api/webhooks/resend/route.js) ledgers every bounce to
// sync_runs (source 'resend-webhook', kind 'bounced', summary.to). Resend's
// `email.bounced` is the permanent kind (a soft failure arrives as
// `email.delivery_delayed`); from fri-3 the webhook also stores
// summary.bounceType, and a bounce Resend calls 'Transient' does not suppress.
// Rows written before fri-3 carry no type and count as hard - what Resend meant.
//
// EVERY MARKETING OR ACCOUNT SEND ASKS HERE FIRST: the welcome mail, the
// broadcast roster, the newsletter confirmation, and the morning email when it
// is built. lib/email/suppression.test.mjs walks the tree and refuses a new
// resend.emails.send() call site that neither imports this module nor is
// exempt by name (sign-in codes, the owner's own alerts).
//
// Addresses compare trimmed and lower-cased: a mailbox is case-insensitive in
// practice, and "Bob@iCloud.com" bouncing means "bob@icloud.com" bounces too.

export const norm = (address) => String(address ?? '').trim().toLowerCase();

/** PURE: does one webhook ledger row suppress its address? */
export function isHardBounceRow(row) {
  if (!row || row.kind !== 'bounced') return false;
  const t = String(row.summary?.bounceType ?? '').toLowerCase();
  return t !== 'transient';
}

/** Has this address hard-bounced? One indexed read (idx_sync_runs_source_kind). */
export async function isHardBounced(sql, address) {
  const a = norm(address);
  if (!a) return false;
  const rows = await sql`
    SELECT 1 AS x FROM sync_runs
     WHERE source = 'resend-webhook' AND kind = 'bounced'
       AND lower(trim(summary->>'to')) = ${a}
       AND lower(COALESCE(summary->>'bounceType', 'permanent')) <> 'transient'
     LIMIT 1`;
  return rows.length > 0;
}

/** Every hard-bounced address, normalised - for a roster's WHERE clause. */
export async function hardBouncedAddresses(sql) {
  const rows = await sql`
    SELECT DISTINCT lower(trim(summary->>'to')) AS a FROM sync_runs
     WHERE source = 'resend-webhook' AND kind = 'bounced'
       AND summary->>'to' IS NOT NULL
       AND lower(COALESCE(summary->>'bounceType', 'permanent')) <> 'transient'`;
  return rows.map((r) => r.a).filter(Boolean);
}
