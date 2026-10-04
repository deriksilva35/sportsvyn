// scripts/retention-dry-run.mjs - what the data-retention job WOULD delete,
// per table and rule, read-only. The rules and why each is kept:
// lib/ops/dataRetention.js. This is the report Derik reads before the GO.
//
//   set -a && . ./.env.local && set +a
//   node scripts/retention-dry-run.mjs            # DEV (DATABASE_URL)
//   node scripts/retention-dry-run.mjs --prod     # PROD, SELECT only
//
// SELECT ONLY: every statement here is a count. It uses the job's own count
// queries (countOddsUnit / countSyncRuns), so the numbers are the job's, not
// a second opinion. With --prod the credential is PROD_DATABASE_URL from the
// environment, never a command-line string.
import { neon } from '@neondatabase/serverless';
import { runRetention } from '../lib/ops/dataRetention.js';

const prod = process.argv.includes('--prod');
const url = prod ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error(`${prod ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} not set - source .env.local`);
const sql = neon(url);

const MB = (b) => `${(b / 1048576).toFixed(1)} MB`;
const day = (t) => (t ? String(t).slice(0, 16).replace('T', ' ') : '-');

const [sizes] = await sql`
  SELECT pg_total_relation_size('odds_markets')::bigint AS om_total, pg_relation_size('odds_markets')::bigint AS om_heap,
         (SELECT reltuples FROM pg_class WHERE oid = 'odds_markets'::regclass)::bigint AS om_rows,
         pg_total_relation_size('sync_runs')::bigint AS sr_total,
         (SELECT count(*) FROM sync_runs)::bigint AS sr_rows,
         pg_database_size(current_database())::bigint AS db`;

const t0 = Date.now();
const s = await runRetention({ sql, mode: 'dry-run', budgetMs: Infinity });

const table = (name, verdicts, totalBytes, totalRows) => {
  console.log(`\n${name}`);
  console.log(`  ${'rule'.padEnd(10)} ${'rows'.padStart(10)} ${'tuple bytes'.padStart(12)}  oldest             newest`);
  let rows = 0;
  for (const [v, a] of Object.entries(verdicts).sort()) {
    rows += a.n;
    console.log(`  ${v.padEnd(10)} ${String(a.n).padStart(10)} ${MB(a.bytes).padStart(12)}  ${day(a.oldest).padEnd(18)} ${day(a.newest)}`);
  }
  const del = verdicts.delete?.n ?? 0;
  const share = totalRows > 0 ? (del / Math.max(totalRows, rows)) * totalBytes : 0;
  console.log(`  -> would delete ${del} of ${rows} rows; est. ${MB(share)} of the table's ${MB(totalBytes)} (proportional, heap + indexes)`);
  return { del, share };
};

console.log(`data-retention DRY RUN on ${prod ? 'PROD' : 'DEV'} at ${new Date().toISOString()}`);
console.log(`cutoffs: odds < ${s.cutoffs.odds}  logs < ${s.cutoffs.logs}  quota < ${s.cutoffs.quota}`);
console.log(`database ${MB(Number(sizes.db))}; odds_markets ${MB(Number(sizes.om_total))} (heap ${MB(Number(sizes.om_heap))}); sync_runs ${MB(Number(sizes.sr_total))}`);
const o = table(`odds_markets  (${s.odds.candidates} candidate matches + futures; ${s.odds.unitsDone}/${s.odds.units} units counted)`,
  s.odds.verdicts, Number(sizes.om_total), Number(sizes.om_rows));
const anchors = ['open', 'close', 'last'].reduce((n, k) => n + (s.odds.verdicts[k]?.n ?? 0), 0);
console.log(`  anchors kept forever (open + close + last): ${anchors}`);
const r = table('sync_runs', s.syncRuns, Number(sizes.sr_total), Number(sizes.sr_rows));
console.log(`\nTOTAL would delete ${o.del + r.del} rows, est. ${MB(o.share + r.share)}. Counted in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
