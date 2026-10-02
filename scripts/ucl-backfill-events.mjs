// scripts/ucl-backfill-events.mjs - the Champions League's matchday-1 goals,
// cards and team stats (ruling fri-4); see lib/soccer/uclBackfill.js.
//
// DRY RUN BY DEFAULT: lists the finals it would fetch, makes no request.
// --apply makes ONE /fixtures?ids= request and writes events + team stats
// through the live tick's own atoms. Idempotent: a second run lists nothing.
//
// The atoms write through lib/db.js (DATABASE_URL), so --prod requires
// DATABASE_URL to BE the PROD credential - set from the environment, never typed:
//   set -a && . ./.env.local && set +a
//   DATABASE_URL="$PROD_DATABASE_URL" node scripts/ucl-backfill-events.mjs --prod           # dry run
//   DATABASE_URL="$PROD_DATABASE_URL" node scripts/ucl-backfill-events.mjs --prod --apply   # 1 request
// Without --prod it runs on DEV (DATABASE_URL as sourced). [week] defaults to 1.

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');
const week = Number(args.find((a) => /^\d{1,2}$/.test(a)) ?? 1);

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing - source .env.local'); process.exit(2); }
if (PROD && process.env.DATABASE_URL !== process.env.PROD_DATABASE_URL) {
  console.error('--prod: run with DATABASE_URL="$PROD_DATABASE_URL" (the atoms write through lib/db.js)'); process.exit(2);
}
if (!PROD && process.env.PROD_DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) {
  console.error('DATABASE_URL is the PROD credential - pass --prod to mean it'); process.exit(2);
}

const { sql } = await import('../lib/db.js');
const { apiSports } = await import('../lib/apiSports.js');
const { backfillUclEvents } = await import('../lib/soccer/uclBackfill.js');

const r = await backfillUclEvents({ sql, client: apiSports, apply: APPLY, week });
console.log(`[ucl-backfill] ${PROD ? 'PROD' : 'DEV'} matchday ${week}: ${r.candidates.length} final(s) without events${APPLY ? '' : ' - DRY RUN, no request, nothing written'}`);
for (const s of r.candidates) console.log(`  ${s}`);
if (APPLY) {
  console.log(`[ucl-backfill] APPLIED: ${r.requests} request, ${r.written.length} written, ${r.missing.length} missing from the response`);
  for (const w of r.written) console.log(`  ${w.slug}: ${w.events} events${w.stats ? ', team stats' : ''}`);
  for (const m of r.missing) console.log(`  MISSING ${m}`);
  if (r.missing.length) process.exit(1);
}
