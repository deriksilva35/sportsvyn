// scripts/mlb-standings-import.mjs - the seeds, into team_records.
// DRY RUN BY DEFAULT.
//
//   set -a && . ./.env.local && set +a
//   node scripts/mlb-standings-import.mjs --prod 2026
//   node scripts/mlb-standings-import.mjs --prod --apply 2026
//
// It runs again every day of the last fortnight of the season, when the seeds
// are still moving, and once more when they are settled - so it lives here.

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { fetchMlbStandings, writeMlbStandings } from '../lib/mlb/standings.js';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');
const seasons = args.filter((a) => !a.startsWith('--'));
if (!seasons.length) { console.error('REFUSE: name a season, e.g. 2026'); process.exit(1); }

const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) { console.error('REFUSE: database url missing in env'); process.exit(1); }
const sql = neon(url);
console.log(`TARGET ${new URL(url).host} | FP ${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)} | ${APPLY ? 'APPLY' : 'DRY RUN'}`);

const [league] = await sql`SELECT id FROM leagues WHERE slug = 'mlb' LIMIT 1`;
if (!league) { console.error('REFUSE: no mlb league row - run mlb-league-import first'); process.exit(1); }

for (const season of seasons) {
  const rows = await fetchMlbStandings(season);
  console.log(`\n${season}: ${rows.length} clubs`);
  const seeded = rows
    .filter((r) => Number(r.playoff_seed) >= 1 && Number(r.playoff_seed) <= 6)
    .sort((a, b) => String(a.team.league).localeCompare(String(b.team.league))
      || Number(a.playoff_seed) - Number(b.playoff_seed));
  console.log('  the twelve (seeds 1-6 per league):');
  for (const r of seeded) {
    console.log(`    ${String(r.team.league).padEnd(9)} ${r.playoff_seed}  ${String(r.team.abbreviation).padEnd(4)} ${r.wins}-${r.losses}  ${r.division_short_name}`);
  }
  // A BRACKET IS TWELVE CLUBS. Fewer means the seeds are not settled; more
  // means we are reading them wrong. Printed either way, never enforced here -
  // this script reports the feed, it does not referee it.
  if (seeded.length !== 12) console.log(`  << ${seeded.length} clubs in seeds 1-6, not 12`);
  if (!APPLY) { console.log('\nDRY RUN ONLY.\n'); continue; }
  const res = await writeMlbStandings(sql, league.id, Number(season), rows);
  console.log(`\nAPPLIED  written ${res.written} | refused ${res.refused.length}${res.refused.length ? ` (${res.refused.join(', ')})` : ''}`);
}
