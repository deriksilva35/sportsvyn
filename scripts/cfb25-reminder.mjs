// scripts/cfb25-reminder.mjs - DRY RUN of the "CFB 25 due" email (mon-9).
// Prints the email; sends nothing, writes nothing (no sync_runs marker).
//
//   set -a && . ./.env.local && set +a
//   node scripts/cfb25-reminder.mjs                 # DEV, newest AP week
//   node scripts/cfb25-reminder.mjs --prod          # PROD reads (SELECT only)
//   node scripts/cfb25-reminder.mjs --week 7        # force a week, even one already done
//
// --prod reads PROD_DATABASE_URL from the environment (never inline).
const args = process.argv.slice(2);
if (args.includes('--prod')) {
  if (!process.env.PROD_DATABASE_URL) { console.error('PROD_DATABASE_URL missing'); process.exit(1); }
  process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
}
const wi = args.indexOf('--week');
const forced = wi >= 0 ? Number(args[wi + 1]) : null;

const { sql } = await import('../lib/db.js');
const { currentApRanks } = await import('../lib/cfb/rankings.js');
const { runReminder } = await import('../lib/cfb/editorReminder.js');

const readAp = async () => { const { season, week } = await currentApRanks(); return { season, week }; };
let season = null;
if (forced != null) season = (await readAp()).season;
const out = await runReminder({
  sql, dryRun: true, force: forced != null, season, week: forced, readAp,
  send: () => { throw new Error('a dry run never sends'); },
});
if (out.decision !== 'dry-run') {
  console.log(`[cfb25-reminder] would do nothing: ${out.decision}` + (out.week ? ` (season ${out.season}, AP week ${out.week})` : ''));
} else {
  console.log(`To: ${process.env.REMINDER_TO ?? 'deriksilva@gmail.com'}\nSubject: ${out.subject}\n\n${out.body}`);
}
