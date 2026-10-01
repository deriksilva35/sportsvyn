// lib/gridiron/oddsBudget.js - how much of The Odds API's monthly plan is
// spent, and by which sport (thu-12, item 4). PURE: no database, no fetch.
// The route (app/api/cron/odds-budget) and lib/gridiron/oddsBudgetRun.js do
// the reading; everything that decides what the phone says lives here.
//
// THE PLAN IS WHAT THE VENDOR SAYS IT IS: used + remaining from the response
// headers (100,000 on 1 Oct 2026). Never a literal - a smaller key answering
// in its place is exactly the failure keyAlert (propsIngest.js) exists for,
// and a hard-coded plan would hide it.
//
// THE SPLIT IS EACH SPORT'S SHARE OF CREDITS USED, not of the plan: the
// shares add up to 100. Attribution is per run, from sync_runs - an odds or
// futures run costs its requests_last (one call per league per run), a props
// run its creditsLast. Measured 17-30 Sep 2026: that sum was 15,293 and the
// account's own requests_used moved by exactly 15,293.

/** Percent of plan crossings that push, once each per month. */
export const THRESHOLDS = Object.freeze([50, 70, 90]);

/** The source ids whose runs spend credits: '<sport>-odds|props|futures'. */
export const SPEND_SOURCE_RE = /^([a-z0-9]+)-(odds|props|futures)$/;

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** '36123' -> '36,123'. */
export const fmt = (n) => Math.round(Number(n)).toLocaleString('en-US');

/** The vendor's headers -> { used, remaining, plan }, or null if unreadable. */
export function planOf(budget) {
  const used = num(budget?.requests_used ?? budget?.used);
  const remaining = num(budget?.requests_remaining ?? budget?.remaining);
  if (used == null || remaining == null) return null;
  return { used, remaining, plan: used + remaining };
}

/** Whole percent of plan used, rounded for display. */
export function pctOf(used, plan) {
  if (!(plan > 0)) return 0;
  return Math.round((used / plan) * 100);
}

/**
 * The HIGHEST threshold crossed, or null. Exact ratio, not the rounded
 * display: 49.6% shows as "50%" but has not crossed 50. Only the highest is
 * returned, so a first run at 92% pushes 90 alone, never 50, 70 and 90 at once.
 */
export function thresholdCrossed(used, plan, thresholds = THRESHOLDS) {
  if (!(plan > 0)) return null;
  const ratio = (used / plan) * 100;
  const crossed = thresholds.filter((t) => ratio >= t);
  return crossed.length ? Math.max(...crossed) : null;
}

/** 'YYYY-MM' of `now` in UTC - the vendor's window is the UTC calendar month. */
export const monthKey = (now = new Date()) => new Date(now).toISOString().slice(0, 7);

/** The first instant of `now`'s UTC month. */
export function monthStart(now = new Date()) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** ONE EVENT PER THRESHOLD PER MONTH: notifyPersonalized sends an id once. */
export const eventIdFor = (threshold, now = new Date()) => `ops-odds-budget:${monthKey(now)}:${threshold}`;

/**
 * Credits per sport -> 'NFL 41% · CFB 30% · EPL 29%'. Descending by credits;
 * shares rounded by largest remainder so they add to exactly 100. Sports with
 * no spend are left out.
 */
export function splitText(bySport) {
  const rows = Object.entries(bySport ?? {})
    .map(([sport, credits]) => ({ sport, credits: Number(credits) || 0 }))
    .filter((r) => r.credits > 0)
    .sort((a, b) => b.credits - a.credits || a.sport.localeCompare(b.sport));
  const total = rows.reduce((s, r) => s + r.credits, 0);
  if (!total) return 'no sport spend yet';
  const exact = rows.map((r) => (r.credits / total) * 100);
  const share = exact.map(Math.floor);
  let left = 100 - share.reduce((s, v) => s + v, 0);
  const byRemainder = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of byRemainder) { if (left <= 0) break; share[i] += 1; left -= 1; }
  return rows.map((r, i) => `${r.sport.toUpperCase()} ${share[i]}%`).join(' · ');
}

/** The copy's params: 'Odds API {pct}% of plan ({used} / {plan}) · {split}'. */
export function budgetParams({ used, plan }, bySport) {
  return { pct: String(pctOf(used, plan)), used: fmt(used), plan: fmt(plan), split: splitText(bySport) };
}

/**
 * Everything the run decides, from what it read. `usage` is planOf()'s shape.
 * eventId is null when no threshold is crossed - nothing to push.
 */
export function budgetVerdict({ usage, bySport, now = new Date() }) {
  const threshold = thresholdCrossed(usage.used, usage.plan);
  return {
    pct: pctOf(usage.used, usage.plan),
    threshold,
    eventId: threshold == null ? null : eventIdFor(threshold, now),
    params: budgetParams(usage, bySport),
  };
}
