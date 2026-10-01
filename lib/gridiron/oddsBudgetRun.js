// lib/gridiron/oddsBudgetRun.js - the daily odds-budget run (thu-12, item 4):
// read the account's usage, split this month's spend by sport, and push the
// admin's phone when a threshold is crossed. The route is a thin wrapper; the
// decisions are pure, in ./oddsBudget.js.
//
// USAGE IS READ FROM THE VENDOR FIRST, FOR FREE. /v4/sports costs 0 credits
// and carries the same budget headers as a priced call. It has to run where
// the PROD key is (Vercel): the droplet's .env.local key is a different
// 500-credit account, so a probe from there reads the wrong plan.
// IF THAT CALL FAILS, the newest budget an odds/props/futures run recorded in
// sync_runs THIS MONTH is the fallback - every one of those runs stores the
// headers. A budget from last month is no reading at all: the window reset.

import { notifyPersonalized } from '../push/notify.js';
import { ADMIN_USER_IDS } from '../admin/gate.js';
import { planOf, budgetVerdict, monthStart, SPEND_SOURCE_RE } from './oddsBudget.js';

/** Credits per sport since the month began, attributed per run. */
export async function sportSpendThisMonth(sql, now = new Date()) {
  const rows = await sql`
    SELECT source,
           sum(CASE WHEN source LIKE '%-props'
                    THEN coalesce((summary->>'creditsLast')::int, 0)
                    ELSE coalesce((summary->'budget'->>'requests_last')::int, 0) END)::int AS credits
      FROM sync_runs
     WHERE started_at >= ${monthStart(now).toISOString()}::timestamptz
       AND kind <> 'alert'
       AND summary->'budget' IS NOT NULL
       AND source ~ '^[a-z0-9]+-(odds|props|futures)$'
     GROUP BY source`;
  const bySport = {};
  for (const r of rows) {
    const m = SPEND_SOURCE_RE.exec(r.source);
    if (!m) continue;
    bySport[m[1]] = (bySport[m[1]] ?? 0) + (Number(r.credits) || 0);
  }
  return bySport;
}

/** The newest budget headers a spending run recorded this month, or null. */
export async function latestRecordedBudget(sql, now = new Date()) {
  const rows = await sql`
    SELECT summary->'budget' AS budget, started_at
      FROM sync_runs
     WHERE started_at >= ${monthStart(now).toISOString()}::timestamptz
       AND source ~ '^[a-z0-9]+-(odds|props|futures)$'
       AND summary->'budget'->>'requests_used' IS NOT NULL
     ORDER BY started_at DESC
     LIMIT 1`;
  return rows[0] ? { budget: rows[0].budget, at: rows[0].started_at } : null;
}

/** Vendor headers, else this month's newest recorded ones. Throws if neither. */
export async function readUsage({ sql, fetchUsage, now = new Date() }) {
  let vendorError = null;
  try {
    const usage = planOf(await fetchUsage());
    if (usage) return { ...usage, from: 'vendor' };
    vendorError = 'unreadable budget headers';
  } catch (e) {
    vendorError = String(e?.message ?? e).slice(0, 160);
  }
  const rec = await latestRecordedBudget(sql, now);
  const usage = rec && planOf(rec.budget);
  if (usage) return { ...usage, from: 'sync_runs', recordedAt: rec.at, vendorError };
  throw new Error(`odds-budget: no usage reading (vendor: ${vendorError}; no budget recorded this month)`);
}

/** Never throws: a push that cannot be sent must not cost the run its record. */
export async function pushOddsBudget({ eventId, params, notify = notifyPersonalized, admins = ADMIN_USER_IDS }) {
  try {
    return await notify(eventId, admins.map((userId) => ({ userId, params })));
  } catch (e) {
    return { error: String(e?.message ?? e).slice(0, 120) };
  }
}

/** One run: read, decide, push the highest crossed threshold once a month. */
export async function runOddsBudget({ sql, fetchUsage, notify = notifyPersonalized, now = new Date() }) {
  const usage = await readUsage({ sql, fetchUsage, now });
  const bySport = await sportSpendThisMonth(sql, now);
  const verdict = budgetVerdict({ usage, bySport, now });
  const push = verdict.eventId ? await pushOddsBudget({ eventId: verdict.eventId, params: verdict.params, notify }) : null;
  return {
    used: usage.used,
    remaining: usage.remaining,
    plan: usage.plan,
    pct: verdict.pct,
    from: usage.from,
    ...(usage.vendorError ? { vendorError: usage.vendorError } : {}),
    bySport,
    threshold: verdict.threshold,
    eventId: verdict.eventId,
    split: verdict.params.split,
    push,
  };
}
