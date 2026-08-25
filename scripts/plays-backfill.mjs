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
// ============================================================================
// EVERY IMPORT IN THIS FILE IS DYNAMIC, AND THAT IS NOT A STYLE CHOICE.
// ============================================================================
// ES module imports are HOISTED: they are resolved and evaluated before any
// top-level statement runs. lib/db.js reads process.env.DATABASE_URL once, at
// module-evaluation time. So a static `import { importPlaysFor } from ...` at
// the top of this file pulls in lib/db.js and freezes the connection BEFORE the
// `--prod` assignment below has executed.
//
// That is not theoretical. The first version of this script had exactly that
// shape, reported "PROD, 6 games ... done: 1048 plays" - and wrote all 1,048
// rows to the DEV branch, leaving PROD empty. It failed silently and in the
// SAFE direction only by luck; the same bug with the flags reversed writes dev
// data into production.
//
// So: set the environment first, import second, and never add a static import
// to this file. A test pins that.

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valuesOf = (flag) => args.reduce((acc, a, i) => (args[i - 1] === flag ? [...acc, a] : acc), []);

const wantProd = has('--prod');
if (wantProd) {
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

// --- everything below is loaded AFTER DATABASE_URL is settled ---------------
const { sql } = await import('../lib/db.js');
const { importPlaysFor } = await import('../lib/gridiron/playsImport.js');

// The target is ASSERTED, not assumed. If the resolved connection is not the
// one the flags asked for, stop before writing anything.
if (wantProd && process.env.DATABASE_URL !== process.env.PROD_DATABASE_URL) {
  console.error('refusing: --prod given but DATABASE_URL is not PROD_DATABASE_URL');
  process.exit(1);
}
const target = wantProd ? 'PROD' : 'dev';
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

// READ THE ROWS BACK THROUGH THE SAME CONNECTION THAT WROTE THEM. A write
// reported as successful against the wrong database is the failure this script
// has already had once; a read-back is the cheapest thing that would have
// caught it.
if (!has('--dry')) {
  const [back] = await sql`SELECT count(*)::int n FROM plays`;
  console.log(`done: ${totalPlays} plays, ${totalDrives} drives`);
  console.log(`read-back on ${target}: ${back.n} rows now in plays`);
}
