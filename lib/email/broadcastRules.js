// lib/email/broadcastRules.js - the broadcast script's refusal logic, pure.
//
// EXTRACTED SO IT CAN BE TESTED. scripts/broadcast.mjs imports lib/db.js at
// module load, so importing the script under node --test would open a database
// connection to run an assertion about a string. These three decisions are the
// ones with real failure modes - each refusal below maps to a way a broadcast
// goes to the wrong people - so they live where a test can reach them.

/**
 * Which database a connection string points at.
 *
 * 'winter-dawn' is the PROD Neon branch's endpoint slug. Matching on the slug
 * rather than on "not DEV" means an EMPTY or unset DATABASE_URL reads as DEV -
 * the safe direction: the script refuses to live-send at worst, rather than
 * mailing a misread target.
 */
export function databaseFingerprint(url) {
  return String(url || '').includes('winter-dawn') ? 'PROD' : 'DEV';
}

/**
 * A live send must point at PROD.
 *
 * THE FAILURE THIS REFUSES actually happened in a dry run, 18 Aug: the script
 * run without the DATABASE_URL prefix silently targeted DEV and printed
 * RECIPIENTS: 1. As a dry run that was a confusing number; as a --send it
 * would have "sent the broadcast" to one DEV row and reported success, and
 * the real 60 would still be unmailed with the ledger saying otherwise.
 */
export function assertLiveTarget(fingerprint) {
  if (fingerprint !== 'PROD') {
    throw new Error(
      'refusing --send against ' + fingerprint + ': a live send must run with '
      + 'DATABASE_URL="$PROD_DATABASE_URL". A DEV send would mail test rows and '
      + 'write a ledger that says the broadcast went out.',
    );
  }
}

/**
 * --to may only name an owner address.
 *
 * The override ignores the roster, the suppression WHERE clause and the count
 * confirmation - every safety the roster path has. An arbitrary address here
 * would be a side door for mailing any user unthrottled and unlogged-as-
 * broadcast, so the allowlist is the owner exclusion list: the six addresses
 * that are already, by definition, not users.
 */
/**
 * HAS THIS USER ALREADY RECEIVED THIS CAMPAIGN? Pure, over the user's own
 * ledger rows, so the rule is testable without a database.
 *
 * WHY A CAMPAIGN KEY. On 8 Sep 2026 the launch email skipped 76 of 222 as
 * "already sent" - the 76 who had received the 19 Aug email - because the
 * predicate matched source + userId and nothing named WHICH broadcast. A
 * ledger row counts for a campaign only when its summary.campaign equals the
 * campaign's key (the html file's sha256). A row with NO key never matches
 * any campaign: keys are written by every send from now on, so an unkeyed
 * row can only be historic, and history is not this send.
 *
 * `sending` still counts within the stuck window, exactly as before - a
 * second process must not double-send a mail whose first attempt is in
 * flight - but only for the same campaign.
 *
 * @param rows    [{ campaign, outcome, started_at }] - this user's rows,
 *                source='broadcast', kind='send'
 * @param campaign the sha256 of the html being sent
 */
export function sentForCampaign(rows, campaign, { now = new Date(), stuckAfterMinutes = 10 } = {}) {
  if (!campaign) throw new Error('sentForCampaign: a campaign key is required');
  const cutoff = new Date(now).getTime() - stuckAfterMinutes * 60_000;
  return (rows ?? []).some((r) => r.campaign === campaign && (
    r.outcome === 'sent'
    || (r.outcome === 'sending' && new Date(r.started_at).getTime() > cutoff)
  ));
}

/**
 * REWRITE EVERY SITE HREF THROUGH THE CLICK ROUTE. A site href is a
 * site-relative path (href="/weekly") or an absolute https://sportsvyn.com
 * URL. mailto:, other hosts, anchors and anything in `skip` (the unsubscribe
 * placeholder) are left alone. Returns the counts so the caller can assert
 * that everything it meant to rewrite, it rewrote.
 */
export function rewriteHrefs(html, toClickUrl, { skip = [] } = {}) {
  let siteHrefs = 0; let rewrittenCount = 0;
  const out = html.replace(/href="([^"]*)"/g, (m, href) => {
    const raw = href.replace(/&amp;/g, '&');
    if (skip.includes(raw)) return m;
    const isSite = (raw.startsWith('/') && !raw.startsWith('//')) || /^https:\/\/(www\.)?sportsvyn\.com(\/|$)/.test(raw);
    if (!isSite) return m;
    siteHrefs += 1;
    const next = toClickUrl(raw);
    if (!next || next === raw) return m;
    rewrittenCount += 1;
    return `href="${next.replace(/&/g, '&amp;')}"`;
  });
  return { html: out, siteHrefs, rewrittenCount };
}

/** Subject from <title>, preheader from the first display:none block. */
export function emailMeta(html) {
  const decode = (t) => t.replace(/&amp;/g, '&').replace(/&rsquo;/g, '\u2019').replace(/&middot;/g, '·').replace(/&mdash;/g, '—').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  const title = html.match(/<title>([\s\S]*?)<\/title>/i);
  const pre = html.match(/<div[^>]*display:\s*none[^>]*>([\s\S]*?)<\/div>/i);
  return { subject: title ? decode(title[1]) : null, preheader: pre ? decode(pre[1].replace(/<[^>]+>/g, ' ')) : null };
}

/** A plain-text alternative from html: block tags to newlines, tags stripped. */
export function htmlToText(html) {
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) ?? [null, html])[1];
  return body
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<div[^>]*display:\s*none[^>]*>[\s\S]*?<\/div>/i, '')
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, h, t) => `${t.replace(/<[^>]+>/g, '').trim()} (${h.replace(/&amp;/g, '&')})`)
    .replace(/<\/(p|div|h[1-6]|li|tr)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&rsquo;/g, '\u2019').replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l, i, a) => l || (a[i - 1] && a[i - 1] !== '')).join('\n').trim();
}

export function validateTestRecipient(address, ownerAddresses) {
  const a = String(address || '').trim().toLowerCase();
  if (!a) throw new Error('--to requires an address');
  const owners = ownerAddresses.map((o) => o.toLowerCase());
  if (!owners.includes(a)) {
    throw new Error(
      `--to ${address} refused: test sends may only target the owner list. `
      + 'Mailing a user goes through the roster, its suppression clause and '
      + 'the typed count - never through this override.',
    );
  }
  return a;
}
