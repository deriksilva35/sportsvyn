// crew/lib/costWatch.mjs - cost-watch: month-to-date spend against the monthly budget.
//
//   vercel_usd_mtd   sum of BilledCost from Vercel's billing charges (/v1/billing/charges, JSON
//                    lines) for this month, charges tagged to another project excluded.
//   neon_usd_mtd     '-' always: Neon bills compute hours, not dollars (its consumption API reports hours and bytes), so a dollar figure would be a guess. Unknown prints '-', never 0.
//   resend_sent_mtd  emails created this month from Resend's list API; needs resend.token (optional);
//                    '-' without it or when the month does not fit in MAX_PAGES x 100.
//   pace             `unknown` while the Vercel monthly budget is unknown (never `over`); `over` when a KNOWN month-to-date figure, projected to month end (needs >= 3
//                    elapsed days), exceeds its budget (BUDGET_USD below = docs/crew/watch-rules.md,
//                    "cost" > "Budget"); otherwise `ok`. Unknown values never count as over.
// The Vercel token is required (exit 2 without it); the rest is optional.
import { parseArgs, requireToken, readToken, fetchText, fetchJson, usd, SetupError } from './common.mjs';
import { VERCEL_API, VERCEL_PROJECT_ID, VERCEL_TEAM_ID, vercelHeaders } from './vercel.mjs';

/** Monthly budgets in USD. Mirrors the BUDGET line in docs/crew/watch-rules.md (a test pins the match).
 *  vercel = <VERCEL_MONTHLY_USD>, Derik's plan line item; null = unknown (pace=unknown, never over). */
export const BUDGET_USD = Object.freeze({ vercel: null });
export const MIN_ELAPSED_DAYS = 3;
export const MAX_PAGES = 5;

/** PURE. First instant of the UTC month and the fraction of the month elapsed at `now`. */
export function monthProgress(now) {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { start, end, fraction: (d.getTime() - start) / (end - start), elapsedDays: (d.getTime() - start) / 86_400_000 };
}

/** PURE. JSON-lines charges text -> billed USD (this project's charges + untagged team charges). */
export function sumCharges(text, projectId = VERCEL_PROJECT_ID) {
  let total = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let c; try { c = JSON.parse(line); } catch { continue; }
    const tagged = c?.Tags?.ProjectId ?? c?.Tags?.projectId ?? c?.ProjectId ?? null;
    if (tagged && tagged !== projectId) continue;
    total += Number(c?.BilledCost ?? 0) || 0;
  }
  return total;
}

/** PURE. Is month-to-date spend on pace to pass its budget? null/unknown never is. */
export function paceOf({ mtd, budget, fraction, elapsedDays }) {
  if (budget === null || budget === undefined || !Number.isFinite(budget)) return 'unknown';
  if (mtd === null || mtd === undefined || !Number.isFinite(mtd)) return 'ok';
  if (elapsedDays < MIN_ELAPSED_DAYS || fraction <= 0) return 'ok';
  return mtd / fraction > budget ? 'over' : 'ok';
}

/** PURE. -> { summary, code }. */
export function summarize({ vercelUsd, neonUsd = null, resendSent = null, progress, budget = BUDGET_USD.vercel }) {
  const pace = paceOf({ mtd: vercelUsd, budget, ...progress });
  return {
    summary: {
      status: pace === 'over' ? 'regression' : 'ok',
      vercel_usd_mtd: usd(vercelUsd),
      neon_usd_mtd: usd(neonUsd),
      resend_sent_mtd: resendSent === null ? '-' : resendSent,
      pace,
    },
    code: pace === 'over' ? 1 : 0,
  };
}

async function resendCount(token, startMs, fetchImpl) {
  let after = null; let n = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://api.resend.com/emails?limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const body = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` }, label: 'resend emails', fetchImpl });
    const rows = body?.data ?? [];
    for (const r of rows) if (Date.parse(r.created_at) >= startMs) n++;
    const oldest = rows.at(-1);
    if (!body?.has_more || !oldest || Date.parse(oldest.created_at) < startMs) return n;
    after = oldest.id;
  }
  return null; // the month did not fit in the page cap: unknown, not a low count
}

export async function main({ argv, env, fetchImpl, now = Date.now() }) {
  parseArgs(argv, []);
  const token = requireToken('vercel.token', 'Vercel token', env);
  const progress = monthProgress(now);
  const q = new URLSearchParams({ from: new Date(progress.start).toISOString(), to: new Date(now).toISOString(), teamId: VERCEL_TEAM_ID });
  const text = await fetchText(`${VERCEL_API}/v1/billing/charges?${q}`, { headers: vercelHeaders(token), label: 'vercel charges', fetchImpl });
  const vercelUsd = sumCharges(text);
  let resendSent = null;
  const rt = readToken('resend.token', env);
  if (rt) { try { resendSent = await resendCount(rt, progress.start, fetchImpl); } catch (e) { if (!(e instanceof SetupError)) throw e; } }
  const { summary, code } = summarize({ vercelUsd, resendSent, progress });
  const lines = [
    `month to date (UTC), ${progress.elapsedDays.toFixed(1)} days in: vercel $${usd(vercelUsd)} of ${BUDGET_USD.vercel === null ? 'unknown' : `$${BUDGET_USD.vercel}`} budget`,
    `projected month end: $${usd(progress.fraction > 0 ? vercelUsd / progress.fraction : null)}${progress.elapsedDays < MIN_ELAPSED_DAYS ? ' (under 3 days in: pace not judged)' : ''}`,
  ];
  return { lines, summary, code };
}
