// crew/lib/retentionStatus.mjs - retention-status: tables past their retention.
// Reads crew_stats.retention_ages_v (row counts by whole-day age; no row content).
// RETENTION is the one place the keep-days live; crew/watch-rules.md ("retention") states
// the same numbers and crew/lib/crew.test.mjs fails if they drift apart.
import { parseArgs, requireReaderUrl } from './common.mjs';
import { query, num } from './db.mjs';

/** Days a row may live. sessions: days since EXPIRY. A row is overdue past keep + 1 day. */
export const RETENTION = Object.freeze({ app_errors: 30, push_sends: 30, daily_guest_runs: 30, sessions: 30 });

/** PURE. rows: [{ table_name, age_days, row_count }] -> per-table totals/overdue + the summary. */
export function summarize(rows, retention = RETENTION) {
  const per = Object.fromEntries(Object.keys(retention).map((t) => [t, { rows: 0, overdue: 0 }]));
  for (const r of rows) {
    const t = per[r.table_name];
    if (!t) continue;
    const n = num(r.row_count);
    t.rows += n;
    if (num(r.age_days) > retention[r.table_name]) t.overdue += n;
  }
  const names = Object.keys(per);
  const overdueTables = names.filter((t) => per[t].overdue > 0);
  const largest = [...names].sort((a, b) => per[b].rows - per[a].rows || a.localeCompare(b))[0];
  return {
    per,
    summary: {
      // informational until a pruner exists: overdue is reported, never a regression
      status: 'ok',
      tables: names.length,
      overdue: overdueTables.length,
      largest: `${largest}:${per[largest].rows}`,
    },
    code: 0, // NEVER exit 1 for overdue
  };
}

export const SQL = 'SELECT table_name, age_days, row_count FROM crew_stats.retention_ages_v';

export async function main({ argv, env }) {
  parseArgs(argv, []);
  const rows = await query(requireReaderUrl(env), SQL);
  const { per, summary, code } = summarize(rows);
  const lines = Object.entries(per).map(([t, v]) => `  ${t.padEnd(18)} rows=${v.rows} keep=${RETENTION[t]}d overdue_rows=${v.overdue}`);
  return { lines: ['retention (rows older than keep + 1 day are overdue)', ...lines], summary, code };
}
