/**
 * lib/pollers/runRecorder.js — durable run records in sync_runs.
 *
 * recordRun wraps a sync fn: writes a start row, runs it, writes finish
 * (ok + summary jsonb) or the error head. The run executes inside a CFBD
 * ledger (lib/cfbd/client.js), so any run that called CFBD gets `cfbdCalls`
 * and `cfbdByEndpoint` on its row - the per-job call log. Optional `budget`
 * async fn (probeCfbdBudget) is merged into the summary as budget ground
 * truth, and its wall time lands in summary.timings_ms.budgetProbe.
 * recordDecision writes a bare noop / skipped-locked row (no work wrapped).
 * lastGamesRunAt powers the baseline-elapsed cadence check. `sql` is passed in
 * (injectable for tests).
 */

import { withBdlErrors, bdlErrorSummary, bdlFailureMessage } from '../bdl/http.js';
import { withCfbdLedger, cfbdGet, cfbdProcessStats } from '../cfbd/client.js';

// Wrap a sync fn with a sync_runs row. Returns { ok, id, summary? , error? }.
export async function recordRun(sql, { source, kind, run, budget = null, log = console.log }) {
  const ins = await sql`
    INSERT INTO sync_runs (source, kind, started_at, ok)
    VALUES (${source}, ${kind}, now(), false) RETURNING id`;
  const id = ins[0].id;
  try {
    // TWO SCOPES (merge of bdl-errors-fail + cfbd-efficiency): the BDL error scope
    // wraps the CFBD call ledger, so a run both counts its CFBD calls and fails on
    // any secondary-feed 4xx/5xx.
    const { value, bdlErrors } = await withBdlErrors(async () => (await withCfbdLedger(async (ledger) => {
      const out = (await run()) ?? {};
      if (budget) {
        const t0 = Date.now();
        try { out.budget = await budget({ ledger, sql }); }
        catch (e) { out.budget_error = String(e?.message ?? e).slice(0, 120); }
        if (out && typeof out === 'object' && !Array.isArray(out)) {
          out.timings_ms = { ...(out.timings_ms ?? {}), budgetProbe: Date.now() - t0 };
        }
      }
      // AFTER the budget, so a fallback probe is counted too.
      if (ledger.calls > 0) { out.cfbdCalls = ledger.calls; out.cfbdByEndpoint = ledger.byEndpoint; }
      return out;
    })).value);
    const summary = value ?? {};
    // PER-GAME ERRORS MAY NEVER HIDE INSIDE AN ok=true (ruling sun-6). The work
    // run() did is kept - its siblings were written and the summary says so -
    // but the row is FAILED and `error` names the statuses and endpoints, so
    // every caller's existing `if (!res.ok) maybeAlert(...)` fires under its
    // own source. 3 Oct: 66 cfb-live-lines runs of 401s, each ok=true.
    if (bdlErrors.length) {
      summary.bdlErrors = bdlErrorSummary(bdlErrors);
      const head = bdlFailureMessage(bdlErrors);
      await sql`UPDATE sync_runs SET finished_at = now(), ok = false, error = ${head}, summary = ${JSON.stringify(summary)}::jsonb WHERE id = ${id}`;
      log(`[poller] ${source}/${kind} FAILED #${id} ${head}`);
      return { ok: false, id, error: head, summary };
    }
    await sql`UPDATE sync_runs SET finished_at = now(), ok = true, summary = ${JSON.stringify(summary)}::jsonb WHERE id = ${id}`;
    log(`[poller] ${source}/${kind} ok #${id} ${JSON.stringify(summary)}`);
    return { ok: true, id, summary };
  } catch (err) {
    const head = String(err?.stack ?? err?.message ?? err).slice(0, 800);
    await sql`UPDATE sync_runs SET finished_at = now(), ok = false, error = ${head} WHERE id = ${id}`;
    log(`[poller] ${source}/${kind} FAILED #${id} ${head}`);
    return { ok: false, id, error: head };
  }
}

// A bare decision row: 'noop' or 'skipped-locked'. No work wrapped.
export async function recordDecision(sql, { source, kind, summary = {}, ok = true }) {
  const r = await sql`
    INSERT INTO sync_runs (source, kind, started_at, finished_at, ok, summary)
    VALUES (${source}, ${kind}, now(), now(), ${ok}, ${JSON.stringify(summary)}::jsonb) RETURNING id`;
  return r[0].id;
}

// Most recent successful games run (live-poll | baseline) for a source — the
// baseline-elapsed check reads this.
export async function lastGamesRunAt(sql, source) {
  const r = await sql`
    SELECT started_at FROM sync_runs
     WHERE source = ${source} AND kind IN ('live-poll', 'baseline') AND ok = true
     ORDER BY started_at DESC LIMIT 1`;
  return r[0]?.started_at ?? null;
}

// CFBD BUDGET GROUND TRUTH, WITHOUT SPENDING A CALL TO LEARN IT (sun-9 d).
//
// This used to be one /conferences request on EVERY ledgered CFBD run - 3 Oct
// alone that was 676 plays-live cycles + 180 cfb-games ticks, ~850 calls spent
// reading a number every other CFBD response already carries. Now, in order:
//
//   1. the run's own calls: lib/cfbd/client.js reads x-calllimit-remaining
//      off every response, so a run that touched CFBD already knows. Free.
//   2. a reading this process took within the hour (a warm Vercel instance or
//      the droplet). Free; marked `from: 'process'` with its own timestamp.
//   3. a reading on ANY sync_runs row within the hour - then this row simply
//      says so and spends nothing.
//   4. only then, one /conferences call: at most about one an hour, which is
//      what keeps (e)'s burn projection fed on a day nothing else runs.
//
// The shape is the one the watchdog reads (lib/ops/cfbdQuota.js):
//   { cfbd_calllimit_remaining: <int>, at: <iso>, from: 'run'|'process'|'probe' }
export const BUDGET_PROBE_INTERVAL_MIN = 60;
// Every (source, kind) whose rows carry summary.budget - the watchdog reads these.
export const CFBD_BUDGET_RUNS = Object.freeze({
  sources: Object.freeze(['cfb-games', 'plays-live', 'cfb-rankings', 'gridiron-teams']),
  kinds: Object.freeze(['live-poll', 'baseline', 'season', 'live-plays', 'weekly', 'teams']),
});

export async function probeCfbdBudget({ ledger = null, sql = null, now = new Date(), fetchJson = null, deadlineAt = null } = {}) {
  if (ledger?.quota) return { cfbd_calllimit_remaining: ledger.quota.remaining, at: ledger.quota.at, from: 'run' };
  const fresh = (q) => q && now.getTime() - new Date(q.at).getTime() < BUDGET_PROBE_INTERVAL_MIN * 60_000;
  const proc = cfbdProcessStats().quota;
  if (fresh(proc)) return { cfbd_calllimit_remaining: proc.remaining, at: proc.at, from: 'process' };
  if (sql) {
    // The two frequent budget sources only, so idx_sync_runs_source_kind
    // serves it; the daily ones (season, rankings, teams) add nothing hourly.
    const r = await sql`
      SELECT started_at FROM sync_runs
       WHERE source IN ('cfb-games', 'plays-live') AND kind IN ('live-poll', 'baseline', 'live-plays')
         AND started_at > ${new Date(now.getTime() - BUDGET_PROBE_INTERVAL_MIN * 60_000).toISOString()}
         AND summary->'budget'->>'cfbd_calllimit_remaining' IS NOT NULL
       ORDER BY started_at DESC LIMIT 1`;
    if (r.length) return { skipped: 'reading within the hour', last_reading_run_at: r[0].started_at };
  }
  // Through the door, so the probe is counted and its header read like any other.
  // Inside a time budget (plays-live), a probe that cannot finish is skipped:
  // the hour's reading can wait a tick, the function cannot.
  if (deadlineAt != null && deadlineAt - Date.now() < 3000) return { skipped: 'no time left for a probe' };
  await (fetchJson ?? cfbdGet)('/conferences', deadlineAt != null ? { deadlineAt } : undefined);
  const q = cfbdProcessStats().quota;
  return q ? { cfbd_calllimit_remaining: q.remaining, at: q.at, from: 'probe' }
    : { cfbd_calllimit_remaining: null, note: 'no x-calllimit-remaining on the probe' };
}

/**
 * Close this source's rows that a killed function left open (finished_at NULL
 * long after its maxDuration). A Vercel timeout kills the process between
 * recordRun's INSERT and its UPDATE, so nothing inside the run can close it;
 * the next run does. ok=false with the reason, so a forensic read sees a
 * failure, not a run still going. Returns how many it closed.
 */
export async function closeAbandonedRuns(sql, source, { olderThanSec = 180 } = {}) {
  const r = await sql`
    UPDATE sync_runs SET finished_at = now(), ok = false,
           error = COALESCE(error, 'abandoned: no finish recorded (function killed before it closed the row)')
     WHERE source = ${source} AND finished_at IS NULL
       AND started_at < now() - make_interval(secs => ${olderThanSec})
       AND started_at > now() - interval '7 days'
    RETURNING id`;
  return r.length;
}
