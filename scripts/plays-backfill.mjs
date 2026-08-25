#!/usr/bin/env node
// scripts/plays-backfill.mjs - import play-by-play for one or more games.
//
// Belongs in scripts/ rather than the scratchpad because it will be run again:
// every future backfill, every gap-fill after a provider outage, and the manual
// half of the Aug 29 CFB rehearsal all call this.
//
// CREDENTIAL COMES FROM THE ENVIRONMENT, never a literal and never an argument:
//   set -a && . ./.env.local && set +a
//   node scripts/plays-backfill.mjs --slug nfl-2025-reg-w1-dal-phi
//   node scripts/plays-backfill.mjs --slug cfb-2025-reg-w16-army-navy --prod
//
// --prod points DATABASE_URL at PROD_DATABASE_URL for this process only. Without
// it the script writes to the dev branch, which is the safe default.

import { importPlaysFor } from '../lib/gridiron/playsImport.js';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valuesOf = (flag) => args.reduce((acc, a, i) => (args[i - 1] === flag ? [...acc, a] : acc), []);

if (has('--prod')) {
  if (!process.env.PROD_DATABASE_URL) {
    console.error('--prod given but PROD_DATABASE_URL is not set in the environment');
    process.exit(1);
  }
  process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
}

const slugs = valuesOf('--slug');
if (!slugs.length) {
  console.error('usage: plays-backfill.mjs --slug <match-slug> [--slug ...] [--prod] [--dry]');
  process.exit(1);
}

// Imported AFTER DATABASE_URL is settled - lib/db.js reads it at module load.
const { sql } = await import('../lib/db.js');

const target = has('--prod') ? 'PROD' : 'dev';
console.log(`plays-backfill -> ${target}, ${slugs.length} game(s)`);

let totalPlays = 0, totalDrives = 0;
for (const slug of slugs) {
  const [m] = await sql`
    SELECT m.id, m.slug, m.status, l.slug AS league
      FROM matches m JOIN leagues l ON l.id = m.league_id WHERE m.slug = ${slug}`;
  if (!m) { console.error(`  MISS  ${slug} - no such match`); continue; }
  if (has('--dry')) {
    const [c] = await sql`SELECT count(*)::int n FROM plays WHERE match_id = ${m.id}`;
    console.log(`  DRY   ${slug} (${m.league}, ${m.status}) - holds ${c.n} plays now`);
    continue;
  }
  try {
    const r = await importPlaysFor(m.id);
    totalPlays += r.written; totalDrives += r.drives;
    const un = r.runSummary?.unmapped ?? {};
    console.log(`  OK    ${slug} plays=${r.written} drives=${r.drives}`
      + (Object.keys(un).length ? ` unmapped=${JSON.stringify(un)}` : ''));
  } catch (e) {
    // One bad game must not abandon the rest of a slate.
    console.error(`  FAIL  ${slug}: ${e.message}`);
  }
}
console.log(`done: ${totalPlays} plays, ${totalDrives} drives`);
