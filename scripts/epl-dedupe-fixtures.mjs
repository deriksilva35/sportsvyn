// scripts/epl-dedupe-fixtures.mjs - one row per EPL fixture (thu-24). See
// lib/soccer/eplDedupe.js for which row stays and what happens to references.
//
// DRY RUN BY DEFAULT. Reads DATABASE_URL (DEV), or PROD_DATABASE_URL with --prod;
// writes only with --apply. Idempotent: a second --apply finds no pairs.
//   set -a && . ./.env.local && set +a
//   node scripts/epl-dedupe-fixtures.mjs --prod            # the list, writes nothing
//   node scripts/epl-dedupe-fixtures.mjs --prod --apply    # move/delete, then re-list
import { neon } from '@neondatabase/serverless';
import { dedupeEpl, describePlan } from '../lib/soccer/eplDedupe.js';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');
const season = Number(args.find((a) => /^\d{4}$/.test(a)) ?? 2026);
const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) { console.error(`${PROD ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} missing - source .env.local`); process.exit(2); }
const sql = neon(url);

const r = await dedupeEpl(sql, { season, apply: APPLY });
console.log(`[epl-dedupe] ${PROD ? 'PROD' : 'DEV'} season ${season}: ${r.pairs} fixture(s) with ${r.staleRows} stale row(s)${APPLY ? '' : ' - DRY RUN, nothing written'}`);
for (const p of r.plans) console.log(describePlan(p));
if (APPLY) {
  const refused = r.results.flatMap((x) => x.done.filter((d) => d.refused));
  const deleted = r.results.flatMap((x) => x.done.filter((d) => !d.refused));
  console.log(`[epl-dedupe] APPLIED: ${deleted.length} stale row(s) deleted, ${refused.length} refused`);
  for (const d of refused) console.log(`  REFUSED ${d.id}: ${d.refused.join('; ')}`);
  const again = await dedupeEpl(sql, { season });
  console.log(`[epl-dedupe] after: ${again.pairs} fixture(s) still duplicated`);
  if (again.pairs - refused.length > 0) process.exit(1);
}
