// crew/lib/appErrors.mjs - app-errors [window_min=60]: uncaught errors the droplet services recorded.
// Reads crew_stats.app_errors_v (signature, counts, times - never the message text).
//   errors      distinct error signatures (service + stack_hash) seen again inside the window
//   new_hashes  signatures whose FIRST sighting is inside the window (the regression signal)
//   top_source  the service with the most active signatures
import { parseArgs, requireReaderUrl } from './common.mjs';
import { query, num } from './db.mjs';

export const ARGS = [{ name: 'window_min', default: 60, min: 1, max: 10_080 }];

/** PURE. rows: [{ service, errors, new_hashes }] -> the summary fields + exit code. */
export function summarize(windowMin, rows) {
  const errors = rows.reduce((a, r) => a + num(r.errors), 0);
  const newHashes = rows.reduce((a, r) => a + num(r.new_hashes), 0);
  const top = [...rows].filter((r) => num(r.errors) > 0)
    .sort((a, b) => num(b.errors) - num(a.errors) || String(a.service).localeCompare(String(b.service)))[0];
  return {
    summary: { status: newHashes > 0 ? 'regression' : 'ok', window_min: windowMin, errors, new_hashes: newHashes, top_source: top?.service ?? '-' },
    code: newHashes > 0 ? 1 : 0,
  };
}

export const SQL = `SELECT service, count(*)::int AS errors, count(*) FILTER (WHERE first_seen > now() - make_interval(mins => $1))::int AS new_hashes
  FROM crew_stats.app_errors_v WHERE ts > now() - make_interval(mins => $1) GROUP BY service`;

export async function main({ argv, env }) {
  const [windowMin] = parseArgs(argv, ARGS);
  const url = requireReaderUrl(env);
  const rows = await query(url, SQL, [windowMin]);
  const { summary, code } = summarize(windowMin, rows);
  const lines = rows.map((r) => `  ${String(r.service).padEnd(24)} signatures=${r.errors} new=${r.new_hashes}`);
  return { lines: [`app errors, last ${windowMin} min (by service)`, ...lines], summary, code };
}
