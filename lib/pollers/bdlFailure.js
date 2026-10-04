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
// here: an ok=false row under the poller's own source - at most ONE per clock
// hour, later ticks counted on it (ruling sun-10) - then maybeAlert under the
// same source. The alert body is built from bdlFailureMessage(), which
// names statuses and endpoints only, so a 401 every tick fingerprints the same
// and maybeAlert mails it ONCE and counts the repeats on that alert row.
//
// NEVER THROWS. A ledger or mailer failure here is logged by the caller's
// catch and must never take the poller down; `alert` is injectable so a test
// can prove the alert is attempted without reaching the mailer.

import { bdlErrorSummary, bdlFailureMessage } from '../bdl/http.js';
import { recordRun } from './runRecorder.js';

/** The UTC clock hour an instant falls in: [start, end). */
export function clockHour(now = new Date()) {
  const start = new Date(now);
  start.setUTCMinutes(0, 0, 0);
  return { start, end: new Date(start.getTime() + 3_600_000) };
}

/**
 * PURE. Fold one tick's errors into the hour's row summary. The WHOLE summary
 * is computed here and written as one object - no jsonb `||` at all, so
 * nothing nested can be replaced half-way (the CLAUDE.md jsonb law).
 */
export function foldHourSummary(prev, bdlErrors, { at = new Date(), hour } = {}) {
  const atIso = new Date(at).toISOString();
  const out = {
    hour: hour ?? prev?.hour ?? clockHour(at).start.toISOString(),
    ticks: (prev?.ticks ?? 0) + 1,
    firstAt: prev?.firstAt ?? atIso,
    lastAt: atIso,
    byStatus: { ...(prev?.byStatus ?? {}) },
    byEndpoint: { ...(prev?.byEndpoint ?? {}) },
  };
  for (const e of bdlErrors) {
    out.byStatus[e.status] = (out.byStatus[e.status] ?? 0) + 1;
    const k = `${e.status} ${e.endpoint}`;
    out.byEndpoint[k] = (out.byEndpoint[k] ?? 0) + 1;
  }
  // The same rows bdlErrorSummary gives, re-derived from the hour's totals, so
  // a reader of a capped row and of a recordRun row sees one shape.
  out.bdlErrors = Object.entries(out.byEndpoint).map(([k, count]) => {
    const i = k.indexOf(' ');
    return { status: Number(k.slice(0, i)), endpoint: k.slice(i + 1), count };
  }).sort((x, y) => (x.status - y.status) || x.endpoint.localeCompare(y.endpoint));
  return out;
}

/**
 * ONE ROW PER SOURCE PER CLOCK HOUR (ruling sun-10 item 3). The poller ticks
 * every thirty seconds; a 401 on every tick was one failed row each - 120 an
 * hour per league. Now the first failing tick of an hour INSERTs the row and
 * every later one in the same hour folds into it: ticks, per-status and
 * per-endpoint totals, lastAt. A new hour starts a new row. The alert is
 * unchanged - maybeAlert still dedupes it by fingerprint.
 */
export async function reportBdlErrors(sql, { source, kind = 'bdl-errors', bdlErrors = [], context = '', alert = null, now = new Date() } = {}) {
  if (!bdlErrors.length) return null;
  const error = bdlFailureMessage(bdlErrors);
  const { start, end } = clockHour(now);
  let id = null; let summary = null; let folded = false;
  try {
    const [prev] = await sql`
      SELECT id, summary FROM sync_runs
       WHERE source = ${source} AND kind = ${kind}
         AND started_at >= ${start.toISOString()} AND started_at < ${end.toISOString()}
       ORDER BY id DESC LIMIT 1`;
    if (prev) {
      summary = foldHourSummary(prev.summary ?? {}, bdlErrors, { at: now, hour: start.toISOString() });
      const rowError = bdlFailureMessage(summary.bdlErrors);
      await sql`
        UPDATE sync_runs SET finished_at = ${new Date(now).toISOString()}, ok = false, error = ${rowError},
               summary = ${JSON.stringify(summary)}::jsonb
         WHERE id = ${prev.id}`;
      id = prev.id; folded = true;
    } else {
      summary = foldHourSummary(null, bdlErrors, { at: now, hour: start.toISOString() });
      const r = await sql`
        INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, error, summary)
        VALUES (${source}, ${kind}, ${new Date(now).toISOString()}, ${new Date(now).toISOString()}, false, ${error}, ${JSON.stringify(summary)}::jsonb)
        RETURNING id`;
      id = r?.[0]?.id ?? null;
    }
  } catch (e) {
    summary = { ...(summary ?? foldHourSummary(null, bdlErrors, { at: now })), ledgerError: String(e?.message ?? e).slice(0, 160) };
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
  return { id, folded, error, summary, alerted };
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
