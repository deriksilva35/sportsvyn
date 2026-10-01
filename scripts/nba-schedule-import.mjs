// scripts/nba-schedule-import.mjs - a whole NBA season's games into matches.
// DRY RUN BY DEFAULT. Reused at the top of every season and after any bulk
// change the hourly re-sync (/api/cron/nba-schedule, yesterday..+14) cannot
// reach.
//
//   set -a && . ./.env.local && set +a
//   node scripts/nba-schedule-import.mjs [season]                 # DRY RUN, dev
//   node scripts/nba-schedule-import.mjs [season] --apply         # WRITE, dev
//   node scripts/nba-schedule-import.mjs [season] --prod          # DRY RUN, prod
//   node scripts/nba-schedule-import.mjs [season] --prod --apply  # WRITE, prod
//
// season defaults to 2026 (= 2026-27). Needs the league and its teams first:
// scripts/nba-league-import.mjs. Credential from the environment only.

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { fetchNbaSeason, writeNbaMatches } from '../lib/nba/schedule.js';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');
const season = Number(args.find((a) => /^\d{4}$/.test(a)) ?? 2026);

const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) { console.error(`REFUSE: ${PROD ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} missing in env`); process.exit(1); }
const sql = neon(url);
const fp = crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 12);
console.log('='.repeat(78));
console.log(`TARGET        ${new URL(url).host}`);
console.log(`FINGERPRINT   ${fp}`);
console.log(`SEASON        ${season}`);
console.log(`MODE          ${APPLY ? 'APPLY (writes)' : 'DRY RUN (writes nothing)'}`);
console.log('='.repeat(78));

const [league] = await sql`SELECT id FROM leagues WHERE slug = 'nba'`;
if (!league) { console.error('REFUSE: no nba league row. Run scripts/nba-league-import.mjs first.'); process.exit(1); }
const [{ n: teamCount }] = await sql`SELECT count(*)::int AS n FROM teams WHERE league_id = ${league.id}`;
if (teamCount !== 30) { console.error(`REFUSE: the nba league has ${teamCount} teams, not 30.`); process.exit(1); }

const { rows, calls, truncated } = await fetchNbaSeason(season);
if (truncated) { console.error(`REFUSE: the season walk stopped at ${calls} calls with a cursor left.`); process.exit(1); }
const phases = rows.reduce((a, r) => { const k = r.postseason ? 'POST' : 'REG'; a[k] = (a[k] ?? 0) + 1; return a; }, {});
const days = rows.map((r) => r.date).filter(Boolean).sort();
console.log(`\nFEED  ${rows.length} games in ${calls} calls | ${JSON.stringify(phases)} | ${days[0]} .. ${days.at(-1)}`);

const res = await writeNbaMatches(sql, league.id, rows, { dryRun: !APPLY });
const moved = res.changes.filter((c) => c.action === 'update' && c.kickoffFrom !== c.kickoffTo);
console.log(`\n${APPLY ? 'WROTE' : 'WOULD WRITE'}  inserted ${res.inserted} | updated ${res.updated} | refused ${res.refused.length} | tips moved ${moved.length}`);
for (const c of res.changes.slice(0, 5)) console.log('  ', JSON.stringify(c));
if (res.changes.length > 5) console.log(`   ... ${res.changes.length - 5} more`);
for (const c of moved.slice(0, 20)) console.log(`  TIP MOVED ${c.slugTo}: ${c.kickoffFrom} -> ${c.kickoffTo}`);
if (res.refused.length) console.log('  REFUSED', JSON.stringify(res.refused.slice(0, 20)));
if (res.unmapped.length) console.log('  UNMAPPED', JSON.stringify([...new Set(res.unmapped)]));
if (!APPLY) console.log('\nDRY RUN ONLY. Re-run with --apply to write.\n');
