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
 * THE LEDGER IS WRITTEN BEFORE THE SEND, NOT AFTER.
 *
 * It used to be send-then-record, and that ordering cost a real user a
 * duplicate email. On 2026-08-09 user 19's welcome mail went out and the row
 * that was supposed to follow it never landed - the invocation ended in the
 * window between the two statements. Four days later the gap was read as "the
 * hook never ran", a replay was fired, and they got a second copy of the same
 * email. The Resend dashboard settled it: two deliveries, one ledger row, the
 * older one timestamped to the exact minute of signup.
 *
 * The old failure mode was SENT BUT UNRECORDED - invisible, and it actively
 * invites a duplicate, because the guard against duplicates reads the ledger.
 * The new one is RECORDED BUT POSSIBLY UNSENT: a row stuck at 'sending'. That
 * is the safe direction in every way that matters. It is visible, it is
 * countable, and alreadySent() refuses on it, so nobody gets mailed twice
 * because the truth was missing.
 *
 * The cost is real and worth naming: a genuine mid-send crash now leaves a user
 * who may have received nothing and can never be auto-retried. That is a miss
 * we can SEE and decide about, which is strictly better than a duplicate we
 * cannot predict.
 */

/** Open a row before the send. Returns its id, or null if the ledger is down. */
async function recordStart(userId) {
  try {
    const r = await sql`
      INSERT INTO sync_runs (source, kind, started_at, ok, summary)
      VALUES ('welcome-email', 'send', now(), false,
              ${JSON.stringify({ userId, outcome: 'sending' })}::jsonb)
      RETURNING id`;
    return r[0]?.id ?? null;
  } catch (e) {
    // The ledger failing must not fail the send path. But it DOES mean this
    // send is unguarded, so it is logged loudly rather than shrugged off.
    console.error('[welcome-email] could not open a ledger row', { userId, message: e?.message });
    return null;
  }
}

/**
 * Close the row with what actually happened.
 *
 * `messageId` is the Resend id, stored so "did this actually go out" is
 * answerable from the ledger instead of from a screenshot of a dashboard -
 * which is how the duplicate above was finally diagnosed.
 */
async function recordFinish(id, { ok, userId, outcome, reason = null, messageId = null }) {
  const summary = JSON.stringify({ userId, outcome, ...(messageId ? { messageId } : {}) });
  try {
    if (id == null) {
      // recordStart failed. Write a terminal row anyway so the outcome is not
      // lost entirely - one row is better than none, even out of order.
      await sql`
        INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary, error)
        VALUES ('welcome-email', 'send', now(), now(), ${ok}, ${summary}::jsonb,
                ${reason == null ? null : String(reason).slice(0, 500)})`;
      return;
    }
    await sql`
      UPDATE sync_runs
         SET finished_at = now(), ok = ${ok}, summary = ${summary}::jsonb,
             error = ${reason == null ? null : String(reason).slice(0, 500)}
       WHERE id = ${id}`;
  } catch {
    console.error('[welcome-email] could not close the ledger row', { id, userId, ok, outcome, reason });
  }
}

/**
 * Outcomes that mean DO NOT SEND AGAIN.
 *
 * 'sending' counts. A row that never closed might be a mail that went out and
 * lost its acknowledgement - exactly user 19's case - so it is treated as sent.
 * 'disabled' and 'failed' are not here: those are the system declining or
 * genuinely erroring, and both are reasons to try again.
 */
export const BLOCKING_OUTCOMES = ['sent', 'sending'];

/**
 * Has this user already had a welcome mail go out, or possibly go out?
 *
 * A read failure returns TRUE - refuse rather than risk a duplicate. Missing a
 * welcome email is a small loss; sending the same person two is the kind of
 * thing that gets a sending domain reported, and it is the mistake this
 * codebase has actually made.
 */
export async function alreadySent(userId) {
  if (userId == null) return false;
  try {
    const r = await sql`
      SELECT 1 FROM sync_runs
       WHERE source = 'welcome-email'
         AND (summary->>'userId')::int = ${Number(userId)}
         AND summary->>'outcome' = ANY(${BLOCKING_OUTCOMES}::text[])
       LIMIT 1`;
    return r.length > 0;
  } catch (e) {
    console.error('[welcome-email] could not check prior sends, refusing', { userId, message: e?.message });
    return true;
  }
}

/**
 * How long a row may sit at 'sending' before it is considered stuck.
 *
 * A send is a single HTTP round trip; anything still open after a few minutes
 * did not finish, it died.
 */
export const STUCK_AFTER_MINUTES = 10;

/**
 * What the ledger says, including the rows that never closed.
 *
 * The stuck count is the point. Before this existed, the only way to notice a
 * broken send was to compare the users table against the ledger by hand, which
 * is exactly what took four days last time.
 */
export async function welcomeLedgerSummary() {
  const [byOutcome, stuck, missing] = await Promise.all([
    sql`SELECT summary->>'outcome' AS outcome, count(*)::int AS n
          FROM sync_runs WHERE source = 'welcome-email'
         GROUP BY 1 ORDER BY 2 DESC`,
    sql`SELECT id, (summary->>'userId')::int AS user_id, started_at
          FROM sync_runs
         WHERE source = 'welcome-email'
           AND summary->>'outcome' = 'sending'
           AND started_at < now() - make_interval(mins => ${STUCK_AFTER_MINUTES})
         ORDER BY started_at DESC LIMIT 25`,
    // Users with no ledger row at all. After the inversion this should only
    // ever be accounts created before the hook existed - anything newer is a
    // hook that did not fire, which is the original defect returning.
    sql`SELECT u.id, u.email, u.created_at
          FROM users u
         WHERE u.created_at IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM sync_runs s
              WHERE s.source = 'welcome-email'
                AND (s.summary->>'userId')::int = u.id)
         ORDER BY u.created_at DESC LIMIT 25`,
  ]);
  return {
    byOutcome: byOutcome.map((r) => ({ outcome: r.outcome ?? '(none)', n: r.n })),
    stuck,
    missing,
    stuckAfterMinutes: STUCK_AFTER_MINUTES,
  };
}

/**
 * Send the welcome email for a freshly created user.
 *
 * Returns a reason string rather than throwing, so a caller that DOES await it
 * (the tests) can assert on the decision without exception plumbing:
 *   'sent' | 'disabled' | 'no-email' | 'opted-out' | 'already-sent' | 'failed'
 */
export async function sendWelcomeEmail(user) {
  const userId = user?.id ?? null;
  let rowId = null;
  try {
    // Idempotency first, before the ledger row and before the enabled flag: a
    // replay must not be able to double-send regardless of how the flags happen
    // to be set, and it must not leave a spurious 'sending' row behind either.
    if (await alreadySent(userId)) return 'already-sent';

    if (!welcomeEmailEnabled()) {
      // Recorded, not silent. This row is what tells you the hook fired and the
      // flag was off - as opposed to the hook never running at all. No 'sending'
      // stage: nothing is going to be attempted, so the row opens and closes in
      // one write.
      await recordFinish(null, { ok: false, userId, outcome: 'disabled' });
      return 'disabled';
    }
    const to = user?.email;
    // No address is not a failure worth alerting on: Apple relay declines and
    // adapter edge cases both land here, and neither is actionable.
    if (!to) { await recordFinish(null, { ok: false, userId, outcome: 'no-email' }); return 'no-email'; }

    // Suppression. Tolerates the column being absent (migration 059 not yet
    // applied in this environment) by treating an error as "not opted out" -
    // the same answer NULL would give, so a missing column cannot silently
    // suppress every send.
    let optedOut = false;
    try {
      const r = await sql`SELECT email_opted_out_at FROM users WHERE id = ${userId} LIMIT 1`;
      optedOut = r[0]?.email_opted_out_at != null;
    } catch { optedOut = false; }
    if (optedOut) { await recordFinish(null, { ok: false, userId, outcome: 'opted-out' }); return 'opted-out'; }

    // EVERYTHING ABOVE THIS LINE IS A DECISION NOT TO SEND, and closes in one
    // write. Below it we are about to hand mail to a vendor, so the row opens
    // FIRST. If the invocation dies from here on, the row stays at 'sending' -
    // visible, countable, and blocking a replay that might duplicate.
    rowId = await recordStart(userId);

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
      await recordFinish(rowId, { ok: false, userId, outcome: 'failed', reason: res.error.message ?? 'resend-error' });
      return 'failed';
    }
    // The provider id, so "did this actually go out" is answerable here rather
    // than from a dashboard.
    await recordFinish(rowId, { ok: true, userId, outcome: 'sent', messageId: res?.data?.id ?? null });
    return 'sent';
  } catch (e) {
    await recordFinish(rowId, { ok: false, userId, outcome: 'failed', reason: e?.message });
    return 'failed';
  }
}

/**
 * The createUser hook's entry point.
 *
 * THIS USED TO BE A FLOATING PROMISE, AND IT LOST A USER'S EMAIL.
 *
 * The old shape was `Promise.resolve().then(() => sendWelcomeEmail(user))` with
 * nothing awaiting it - deliberately, so the signup would commit without
 * waiting on a mail vendor. On a long-lived server that is fine. On Vercel it
 * is not: once the handler's response is sent, the invocation can be frozen or
 * torn down immediately, and any promise that has not settled is simply
 * discarded. No email, no ledger row, NO ERROR - the work never resumes to
 * report that it did not happen.
 *
 * That is exactly what happened to user 19 on 2026-08-09. User 20 came through
 * the same Apple route four hours later and was fine, which is the tell: the
 * outcome depends on whether the instance happened to stay alive long enough
 * for a Resend round trip plus an INSERT, and nothing in the code decided that.
 * It was never a race between the adapter event and the ledger write - it was a
 * race between the work and the end of the function.
 *
 * after() is the platform's answer to precisely this: work registered with it
 * runs AFTER the response, with the invocation kept alive to finish it. The
 * original design goal survives - the signup still does not block on the mail -
 * and the ledger's contract is restored: silence can once again only mean the
 * code never ran.
 *
 * FALLBACK IS INLINE, NOT FLOATING. Outside a request scope (a script, a test,
 * a runtime without after) the work is awaited instead. sendWelcomeEmail cannot
 * throw - every path is caught and returns a reason string - so awaiting it can
 * never fail a signup. A slower signup is a cost; a silently dropped one is a
 * defect, and we already know which one we shipped.
 */
export async function fireWelcomeEmail(user) {
  try {
    const { after } = await import('next/server');
    after(() => sendWelcomeEmail(user));
    return 'scheduled';
  } catch {
    return sendWelcomeEmail(user);
  }
}
