/**
 * lib/auth/welcomeEmail.js -- the welcome send, fired from the createUser event.
 *
 * THE SIGNUP MUST NEVER FAIL BECAUSE OF AN EMAIL. Everything here is inside a
 * try/catch that swallows, and the caller does not await it. Resend being down,
 * the key being wrong, the template throwing - none of it may propagate into the
 * one flow where a failure costs us the account. The cost of that promise is
 * that a lost send is lost: there is no inline retry, by instruction, so a
 * failure is RECORDED rather than repaired.
 *
 * WHERE FAILURES GO. sync_runs, the same ledger the pollers use, under
 * source='welcome-email'. That is a deliberate choice over console-only: the
 * console on a serverless function is somebody noticing in the moment, while a
 * row is a thing you can count next week. `ok=false` plus the reason string is
 * enough to answer "how many new accounts never got the email".
 *
 * SUPPRESSION is read from users.email_opted_out_at (migration 059). See that
 * file for why a local column rather than Resend's suppression list - the short
 * version is that Resend suppression governs broadcasts, not the transactional
 * API this uses, so trusting it would be a check that silently does nothing.
 *
 * OFF BY DEFAULT. WELCOME_EMAIL_ENABLED must be '1' for anything to send. A new
 * outbound email to every signup is not something to switch on by deploying.
 */

import { sql } from '../db.js';
import { buildWelcomeEmail } from '../emails/welcome.js';

// The address is a single constant so the From decision lives in one place.
// Defaults to the existing verified sender rather than inventing a new one that
// may not be DNS-authorised yet; WELCOME_EMAIL_FROM overrides without a deploy.
export const WELCOME_FROM = process.env.WELCOME_EMAIL_FROM || 'Draftvyn <hello@sportsvyn.com>';

export function welcomeEmailEnabled() {
  return process.env.WELCOME_EMAIL_ENABLED === '1';
}

/** Absolute base for links in the mail. Never a relative URL - this is email. */
function baseUrl() {
  return process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'https://sportsvyn.com';
}

/**
 * The unsubscribe target. Signed with the user id and a secret so the link
 * cannot be walked to unsubscribe somebody else by changing a number in it.
 */
export async function unsubscribeUrlFor(userId) {
  const { createHmac } = await import('node:crypto');
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'dev-only-unsub-secret';
  const token = createHmac('sha256', secret).update(`unsub:${userId}`).digest('hex').slice(0, 32);
  return `${baseUrl()}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${token}`;
}

/**
 * Record one outcome in the pollers' ledger. Never throws.
 *
 * `ok` is reserved for a mail that actually went out. A declined send is not a
 * failure - 'disabled' and 'opted-out' are the system working - but it is still
 * an OUTCOME, and it is written so that silence in this table can only ever mean
 * one thing: the code never ran. The outcome is carried in `summary.outcome`
 * rather than the error column, which stays for things that actually broke.
 */
async function record({ ok, userId, outcome, reason = null }) {
  try {
    await sql`
      INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary, error)
      VALUES ('welcome-email', 'send', now(), now(), ${ok},
              ${JSON.stringify({ userId, outcome })}::jsonb,
              ${reason == null ? null : String(reason).slice(0, 500)})`;
  } catch {
    // The ledger failing must not fail the send path either.
    console.error('[welcome-email] could not record outcome', { userId, ok, outcome, reason });
  }
}

/**
 * Send the welcome email for a freshly created user.
 *
 * Returns a reason string rather than throwing, so a caller that DOES await it
 * (the tests) can assert on the decision without exception plumbing:
 *   'sent' | 'disabled' | 'no-email' | 'opted-out' | 'failed'
 */
export async function sendWelcomeEmail(user) {
  const userId = user?.id ?? null;
  try {
    if (!welcomeEmailEnabled()) {
      // Recorded, not silent. This row is what tells you the hook fired and the
      // flag was off - as opposed to the hook never running at all.
      await record({ ok: false, userId, outcome: 'disabled' });
      return 'disabled';
    }
    const to = user?.email;
    // No address is not a failure worth alerting on: Apple relay declines and
    // adapter edge cases both land here, and neither is actionable.
    if (!to) { await record({ ok: false, userId, outcome: 'no-email' }); return 'no-email'; }

    // Suppression. Tolerates the column being absent (migration 059 not yet
    // applied in this environment) by treating an error as "not opted out" -
    // the same answer NULL would give, so a missing column cannot silently
    // suppress every send.
    let optedOut = false;
    try {
      const r = await sql`SELECT email_opted_out_at FROM users WHERE id = ${userId} LIMIT 1`;
      optedOut = r[0]?.email_opted_out_at != null;
    } catch { optedOut = false; }
    if (optedOut) { await record({ ok: false, userId, outcome: 'opted-out' }); return 'opted-out'; }

    const { resend } = await import('../resend.js');
    const mail = buildWelcomeEmail({
      baseUrl: baseUrl(),
      unsubscribeUrl: await unsubscribeUrlFor(userId),
    });
    const res = await resend.emails.send({
      from: WELCOME_FROM,
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    if (res?.error) {
      await record({ ok: false, userId, outcome: 'failed', reason: res.error.message ?? 'resend-error' });
      return 'failed';
    }
    await record({ ok: true, userId, outcome: 'sent' });
    return 'sent';
  } catch (e) {
    await record({ ok: false, userId, outcome: 'failed', reason: e?.message });
    return 'failed';
  }
}

/**
 * The createUser hook's entry point. Deliberately NOT async from the caller's
 * point of view: it starts the work and returns, so the signup commits without
 * waiting on an SMTP vendor. The floating promise is the whole design, and the
 * catch is belt-and-braces on a function that already cannot throw.
 */
export function fireWelcomeEmail(user) {
  Promise.resolve()
    .then(() => sendWelcomeEmail(user))
    .catch((e) => console.error('[welcome-email] unreachable throw', e));
}
