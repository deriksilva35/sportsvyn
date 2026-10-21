// crew/lib/vercelErrors.mjs - vercel-errors [window_min=60]: production 5xx responses, grouped by route.
// Same endpoint the Vercel CLI's `vercel logs` uses (/api/logs/request-logs), pinned to the
// sportsvyn project (vercel.mjs). Only status code and path are read from each row; log text,
// headers and bodies are never kept or printed.
import { parseArgs, requireToken, fetchJson } from './common.mjs';
import { VERCEL_API, VERCEL_WEB, VERCEL_PROJECT_ID, VERCEL_TEAM_ID, vercelHeaders } from './vercel.mjs';

export const ARGS = [{ name: 'window_min', default: 60, min: 1, max: 1440 }];
export const MAX_PAGES = 4;

/** PURE. rows: request-log rows [{ statusCode, requestPath }] -> counts + exit code. */
export function summarize(windowMin, rows) {
  const fives = rows.filter((r) => Number(r?.statusCode) >= 500 && Number(r?.statusCode) < 600);
  const byRoute = new Map();
  for (const r of fives) {
    const p = String(r.requestPath ?? '').split('?')[0] || '-';
    byRoute.set(p, (byRoute.get(p) ?? 0) + 1);
  }
  const top = [...byRoute.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return {
    byRoute,
    summary: { status: fives.length ? 'regression' : 'ok', window_min: windowMin, errors_5xx: fives.length, routes: byRoute.size, top_route: top?.[0] ?? '-' },
    code: fives.length ? 1 : 0,
  };
}

export function requestLogsUrl(windowMin, page, now = Date.now()) {
  const q = new URLSearchParams({
    projectId: VERCEL_PROJECT_ID,
    ownerId: VERCEL_TEAM_ID,
    page: String(page),
    startDate: String(now - windowMin * 60_000),
    endDate: String(now),
    environment: 'production',
    statusCode: '5xx',
  });
  return `${VERCEL_WEB}/api/logs/request-logs?${q}`;
}

export async function main({ argv, env, fetchImpl }) {
  const [windowMin] = parseArgs(argv, ARGS);
  const token = requireToken('vercel.token', 'Vercel token', env, new URL(VERCEL_API).host);
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await fetchJson(requestLogsUrl(windowMin, page), { headers: vercelHeaders(token), label: 'vercel request logs', fetchImpl });
    rows.push(...(body?.rows ?? []));
    if (!body?.hasMoreRows) break;
  }
  const { byRoute, summary, code } = summarize(windowMin, rows);
  const lines = [...byRoute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([p, n]) => `  ${String(n).padStart(5)}  ${p}`);
  return { lines: [`vercel production 5xx, last ${windowMin} min`, ...lines], summary, code };
}
