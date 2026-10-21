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
// The Vercel token is required (exit 2, reason=auth:api.vercel.com without it); the rest is optional.
// The billing charges are a 13 MB+ JSON-lines export that grows through the month, streamed with an 8 s
// budget; if it cannot be read (timeout, 403/404, unreachable) vercel_usd_mtd prints '-', pace=unknown,
// status stays ok, and a detail line names the cause. Resend failures likewise leave '-'.
import { parseArgs, requireToken, readToken, fetchLines, fetchJson, usd, SetupError } from './common.mjs';
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
  for (const line of String(text).split('\n')) total += chargeCost(line, projectId);
  return total;
}

/** PURE. One JSON line -> its billed USD for this project (0 for blank, unparsable or another project's). */
export function chargeCost(line, projectId = VERCEL_PROJECT_ID) {
  if (!line.trim()) return 0;
  let c; try { c = JSON.parse(line); } catch { return 0; }
  const tagged = c?.Tags?.ProjectId ?? c?.Tags?.projectId ?? c?.ProjectId ?? null;
  if (tagged && tagged !== projectId) return 0;
  return Number(c?.BilledCost ?? 0) || 0;
}

/** The billing export is 13 MB+ of JSON lines and grows through the month: stream it, never buffer it. */
export const BILLING_TIMEOUT_MS = 8_000;
export async function streamedChargesUsd(url, headers, fetchImpl, timeoutMs = BILLING_TIMEOUT_MS) {
  let total = 0;
  await fetchLines(url, (l) => { total += chargeCost(l); }, { headers, timeoutMs, fetchImpl, label: 'vercel charges' });
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
  const token = requireToken('vercel.token', 'Vercel token', env, new URL(VERCEL_API).host);
  const progress = monthProgress(now);
  const q = new URLSearchParams({ from: new Date(progress.start).toISOString(), to: new Date(now).toISOString(), teamId: VERCEL_TEAM_ID });
  const rt = readToken('resend.token', env);
  // Billing and Resend run side by side so a slow billing export cannot starve the optional call.
  const [billing, resend] = await Promise.allSettled([
    streamedChargesUsd(`${VERCEL_API}/v1/billing/charges?${q}`, vercelHeaders(token), fetchImpl),
    rt ? resendCount(rt, progress.start, fetchImpl) : Promise.resolve(null),
  ]);
  const detail = [];
  let vercelUsd = null;
  if (billing.status === 'fulfilled') vercelUsd = billing.value;
  else if (billing.reason instanceof SetupError) detail.push(`vercel billing unavailable: ${billing.reason.reason}`);
  else throw billing.reason;
  let resendSent = null;
  if (resend.status === 'fulfilled') resendSent = resend.value;
  else if (resend.reason instanceof SetupError) detail.push(`resend unavailable: ${resend.reason.reason}`);
  else throw resend.reason;
  const { summary, code } = summarize({ vercelUsd, resendSent, progress });
  if (vercelUsd === null) summary.pace = 'unknown'; // no reading: pace is not judged, never over
  const lines = [
    `month to date (UTC), ${progress.elapsedDays.toFixed(1)} days in: vercel ${vercelUsd === null ? '-' : `$${usd(vercelUsd)}`} of ${BUDGET_USD.vercel === null ? 'unknown' : `$${BUDGET_USD.vercel}`} budget`,
    `projected month end: ${vercelUsd === null || progress.fraction <= 0 ? '-' : `$${usd(vercelUsd / progress.fraction)}`}${progress.elapsedDays < MIN_ELAPSED_DAYS ? ' (under 3 days in: pace not judged)' : ''}`,
  ].concat(detail);
  return { lines, summary, code };
}
