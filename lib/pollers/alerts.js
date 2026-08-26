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

import { createHash } from 'node:crypto';
import { resend, EMAIL_FROM, EMAIL_REPLY_TO } from '../resend.js';

export const ALERT_WINDOW_HOURS = 6;
export const ALERT_EMAIL = 'deriksilva@gmail.com';

/**
 * How many detail entries an alert row may carry. The email body is unbounded
 * and the ledger row is not: a pathological run refusing four hundred kickoffs
 * must not write four hundred objects into a jsonb column that gets SELECTed on
 * every forensic read. Past the cap the count still lands, under detailOverflow
 * - the same shape UNMAPPED_TOKEN_CAP uses for provider tokens.
 */
export const ALERT_DETAIL_CAP = 25;

/**
 * `detail` is an optional array persisted INTO the alert row's own summary.
 *
 * Without it the row stores only a subject line, and answering "which games,
 * and by how much" three weeks later means finding the sync run that happened
 * to trigger this alert and reading ITS summary - a join through a timestamp,
 * across two rows, that nobody performing a forensic read should have to guess
 * at. The alert is the thing someone opens first; it should be self-contained.
 */
/**
 * The alert row's summary payload. PURE, EXPORTED, AND TESTED ON ITS OWN -
 * and that is not a stylistic preference, it is the fix for a real incident.
 *
 * The first version of the detail feature was tested by calling maybeAlert()
 * with a stubbed `sql`. Stubbing the database does NOT stub the mailer: every
 * suite run reached resend.emails.send() and put a real email in Derik's inbox
 * with subject "s" and body "b". Roughly twenty of them before it was noticed.
 *
 * A function that sends email must never be the unit under test for something
 * that isn't sending. Shape the summary here; let maybeAlert use it.
 */
export function alertSummary({ subject, detail = null }) {
  const summary = { subject };
  if (Array.isArray(detail) && detail.length) {
    summary.detail = detail.slice(0, ALERT_DETAIL_CAP);
    if (detail.length > ALERT_DETAIL_CAP) summary.detailOverflow = detail.length - ALERT_DETAIL_CAP;
  }
  return summary;
}

/**
 * A stable fingerprint of an alert's payload, so a condition that persists
 * across ticks is recorded without being mailed twice.
 *
 * WHY IT COVERS THE BODY TOO, not just subject+detail. Most callers send no
 * detail at all, and their subjects are constant by construction - every
 * failure of the CFB games poller is "[pollers] cfb FAILED" regardless of what
 * failed. Fingerprinting subject alone would collapse two genuinely different
 * outages into one and silently withhold the second email. The body carries
 * the error text, so it is what distinguishes them.
 *
 * The bias is deliberate: this suppresses only alerts that are identical down
 * to the character. A body carrying a per-run count differs between runs and
 * is NOT deduped - it falls through to the 6-hour window, which is the older
 * and blunter guard and still in force behind this one.
 */
export function alertFingerprint({ subject, body = '', detail = null }) {
  // Fingerprint the CAPPED detail, i.e. exactly what gets persisted - so two
  // alerts that store the same row cannot carry different fingerprints.
  const { detail: capped = null } = alertSummary({ subject, detail });
  return createHash('sha1')
    .update(JSON.stringify([subject ?? '', body ?? '', capped]))
    .digest('hex')
    .slice(0, 16);
}

export async function maybeAlert(sql, { source, subject, body, detail = null }) {
  const fingerprint = alertFingerprint({ subject, body, detail });

  const recent = await sql`
    SELECT id, summary->>'fingerprint' AS fingerprint,
           COALESCE((summary->>'repeats')::int, 0) AS repeats
      FROM sync_runs
     WHERE source = ${source} AND kind = 'alert'
       AND started_at > now() - make_interval(hours => ${ALERT_WINDOW_HOURS})
     ORDER BY started_at DESC
     LIMIT 1`;

  if (recent.length) {
    const prior = recent[0];
    // THE REPEAT CASE. The same condition still holds on a later tick - eight
    // kickoffs still refused, the same eight, by the same deltas. Emailing it
    // again says nothing new; losing the fact that it recurred says too little.
    // So the LEDGER ROW IS KEPT AND COUNTED, and only the email is suppressed.
    //
    // COUNTED ON THE EXISTING ROW RATHER THAN INSERTED AS A NEW ONE. The plays
    // poller runs every minute; a condition that persists for an afternoon
    // would otherwise write a few hundred near-identical rows into the table
    // every forensic read scans.
    if (prior.fingerprint && prior.fingerprint === fingerprint) {
      // TOP-LEVEL KEYS ONLY, so `||` is doing what it looks like it is doing.
      // `summary` is an object built by alertSummary (never an array, so this
      // cannot append), and `detail` is a SIBLING key that this write does not
      // carry - a shallow merge leaves it intact rather than replacing it. The
      // final_seen_at wipe was exactly this operator applied one level deeper.
      await sql`
        UPDATE sync_runs
           SET summary = summary || jsonb_build_object(
                 'repeats', ${prior.repeats + 1}::int,
                 'lastRepeatAt', to_jsonb(now())),
               finished_at = now()
         WHERE id = ${prior.id}`;
      return { sent: false, reason: 'duplicate_payload', repeats: prior.repeats + 1 };
    }
    // A DIFFERENT payload inside the window is still rate-limited, unchanged.
    // That is the older anti-spam guard and this does not loosen it.
    return { sent: false, reason: 'rate_limited' };
  }

  const summary = { ...alertSummary({ subject, detail }), fingerprint };

  // Burn the window first (anti-spam), then try to send.
  await sql`
    INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
    VALUES (${source}, 'alert', now(), now(), true, ${JSON.stringify(summary)}::jsonb)`;
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
