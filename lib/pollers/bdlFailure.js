// lib/pollers/bdlFailure.js - a FAILED ledger row and an alert for secondary-
// feed errors that happened OUTSIDE recordRun.
//
// recordRun (runRecorder.js) already marks its own run failed when the run's
// scope holds a 4xx/5xx (ruling sun-6). The live poller is the one writer that
// does not run under recordRun: its "run" is a poll window hours long, and its
// box score, plays, probables and board snapshot are each contained in their
// own try so one cannot cost another. Those catches only LOGGED - a 401 on
// every box score would have sat in the journal while the ledger said nothing.
//
// So the poller scopes each tick (withBdlErrors) and hands what it collected
// here: one ok=false row under the poller's own source, then maybeAlert under
// the same source. The alert body is built from bdlFailureMessage(), which
// names statuses and endpoints only, so a 401 every tick fingerprints the same
// and maybeAlert mails it ONCE and counts the repeats on that alert row.
//
// NEVER THROWS. A ledger or mailer failure here is logged by the caller's
// catch and must never take the poller down; `alert` is injectable so a test
// can prove the alert is attempted without reaching the mailer.

import { bdlErrorSummary, bdlFailureMessage } from '../bdl/http.js';
import { recordRun } from './runRecorder.js';

export async function reportBdlErrors(sql, { source, kind = 'bdl-errors', bdlErrors = [], context = '', alert = null } = {}) {
  if (!bdlErrors.length) return null;
  const error = bdlFailureMessage(bdlErrors);
  const summary = { bdlErrors: bdlErrorSummary(bdlErrors) };
  let id = null;
  try {
    const r = await sql`
      INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, error, summary)
      VALUES (${source}, ${kind}, now(), now(), false, ${error}, ${JSON.stringify(summary)}::jsonb)
      RETURNING id`;
    id = r?.[0]?.id ?? null;
  } catch (e) {
    summary.ledgerError = String(e?.message ?? e).slice(0, 160);
  }
  let alerted;
  try {
    const send = alert ?? (await import('./alerts.js')).maybeAlert;
    alerted = await send(sql, {
      source,
      subject: `[pollers] ${source} FAILED`,
      body: `source: ${source}${context ? `\n${context}` : ''}\n\n${error}`,
    });
  } catch (e) {
    alerted = { sent: false, reason: 'alert_failed', error: String(e?.message ?? e).slice(0, 160) };
  }
  return { id, error, summary, alerted };
}

/**
 * recordRun + the alert, as ONE call, for an overlay that has its own ledger
 * source inside some larger tick (cfb-live-lines inside the CFB games sync).
 * A failed run - thrown, or marked failed by a secondary-feed 4xx/5xx inside
 * it - reaches the alert under the overlay's OWN source. Never throws: the
 * overlay is contained, and so is its alert. `alert` is injectable for tests.
 */
export async function runAndAlert(sql, { source, kind, run, context = '', alert = null, log } = {}) {
  const res = await recordRun(sql, { source, kind, run, ...(log ? { log } : {}) });
  if (!res.ok) {
    try {
      const send = alert ?? (await import('./alerts.js')).maybeAlert;
      res.alerted = await send(sql, {
        source,
        subject: `[pollers] ${source} FAILED`,
        body: `source: ${source}${context ? `\n${context}` : ''}\n\n${res.error}`,
      });
    } catch (e) {
      res.alerted = { sent: false, reason: 'alert_failed', error: String(e?.message ?? e).slice(0, 160) };
    }
  }
  return res;
}
