/**
 * lib/pollers/runRecorder.js — durable run records in sync_runs.
 *
 * recordRun wraps a sync fn: writes a start row, runs it, writes finish
 * (ok + summary jsonb) or the error head. Optional `budget` async fn (the CFBD
 * x-calllimit probe) is merged into the summary as budget ground truth.
 * recordDecision writes a bare noop / skipped-locked row (no work wrapped).
 * lastGamesRunAt powers the baseline-elapsed cadence check. `sql` is passed in
 * (injectable for tests).
 */

// Wrap a sync fn with a sync_runs row. Returns { ok, id, summary? , error? }.
export async function recordRun(sql, { source, kind, run, budget = null, log = console.log }) {
  const ins = await sql`
    INSERT INTO sync_runs (source, kind, started_at, ok)
    VALUES (${source}, ${kind}, now(), false) RETURNING id`;
  const id = ins[0].id;
  try {
    const summary = (await run()) ?? {};
    if (budget) {
      try { summary.budget = await budget(); }
      catch (e) { summary.budget_error = String(e?.message ?? e).slice(0, 120); }
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

// CFBD budget ground truth: one cheap /conferences call, returns the remaining
// call-limit header. Used as the recordRun `budget` probe for CFB runs.
export async function probeCfbdBudget() {
  const key = process.env.CFBD_API_KEY;
  if (!key) return { cfbd_calllimit_remaining: null, note: 'no CFBD key' };
  const res = await fetch('https://apinext.collegefootballdata.com/conferences', {
    headers: { Authorization: `Bearer ${key}` },
  });
  return {
    cfbd_calllimit_remaining: res.headers.get('x-calllimit-remaining'),
    cfbd_calllimit_reset: res.headers.get('x-calllimit-reset'),
  };
}
