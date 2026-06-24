// scripts/fix-prod-argentina-flag-dryrun.mjs
//
// READ-ONLY diagnostic + dry-run for fixing PROD's Argentina flag.
// PROD's argentina row points at https://blob.sportsvyn.com/flags/argentina.svg
// which is unreachable (HTTP 000). DEV is clean (flagcdn.com/ar.svg). This
// script SHOWS what the fix would do — writes nothing.
//
//   · Host-guard: refuses to run if PROD_DATABASE_URL doesn't include
//     winter-dawn. Credential is read from env, never inlined.
//   · Survey ALL Argentina rows on PROD (across leagues) so duplicate-slug
//     siblings surface. The proposed UPDATE only targets the WC row
//     (what ranking_entries / /rankings reads), but knowing about the
//     friendlies sibling is part of the diagnosis.
//   · Re-resolve target by natural key (name='Argentina' + WC league)
//     on the PROD branch itself. No DEV-derived ids.
//
// Run:
//   PROD_DATABASE_URL="postgresql://..." node scripts/fix-prod-argentina-flag-dryrun.mjs

import { neon } from '@neondatabase/serverless';

const PROD_URL = process.env.PROD_DATABASE_URL;
if (!PROD_URL) throw new Error('PROD_DATABASE_URL missing — export it in your shell, do not inline.');
const prodHost = new URL(PROD_URL).hostname;
if (!prodHost.includes('winter-dawn')) {
  throw new Error('REFUSE: PROD_DATABASE_URL does not look like PROD (winter-dawn).');
}
console.log('prod host:', prodHost);
const prod = neon(PROD_URL);

// 1. Full sweep — every Argentina row on PROD across all leagues.
console.log('\n' + '='.repeat(80));
console.log('SURVEY: all Argentina rows on PROD (across leagues)');
console.log('='.repeat(80));
const allArg = await prod`
  SELECT t.id, t.slug, t.name, t.abbreviation, t.flag_svg_path, lg.slug AS league_slug
    FROM teams t
    JOIN leagues lg ON lg.id = t.league_id
   WHERE t.name = 'Argentina'
   ORDER BY (lg.slug = 'fifa-wc-2026') DESC, t.id ASC
`;
console.log(`row count: ${allArg.length}`);
for (const r of allArg) console.log('  ' + JSON.stringify(r));

// 2. Resolve the FIX TARGET by natural key — WC league only.
console.log('\n' + '='.repeat(80));
console.log('FIX TARGET (natural key: name + WC league)');
console.log('='.repeat(80));
const target = await prod`
  SELECT t.id, t.slug, t.name, t.flag_svg_path, lg.slug AS league_slug
    FROM teams t
    JOIN leagues lg ON lg.id = t.league_id
   WHERE t.name = 'Argentina'
     AND lg.slug = 'fifa-wc-2026'
`;
console.log(`resolved row count: ${target.length} (expected: 1)`);
for (const r of target) console.log('  ' + JSON.stringify(r));

// 3. Confirm ranking_entries for Argentina points at this team_id.
console.log('\n' + '='.repeat(80));
console.log('CROSS-CHECK: ranking_entries.team_id for Argentina on PROD');
console.log('='.repeat(80));
const re = await prod`
  SELECT e.id AS entry_id, e.rank, e.team_id, e.score::float AS score,
         t.name, t.flag_svg_path, lg.slug AS league_slug
    FROM ranking_entries e
    JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
    JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
    JOIN leagues lg          ON lg.id = rl.league_id
    JOIN teams t             ON t.id  = e.team_id
   WHERE t.name = 'Argentina'
     AND lg.slug = 'fifa-wc-2026'
     AND rl.slug = 'team-power'
     AND ed.is_current = true
     AND ed.status     = 'published'
`;
for (const r of re) console.log('  ' + JSON.stringify(r));
const teamIdsMatch = target.length === 1 && re.length === 1 && target[0].id === re[0].team_id;
console.log(`  ↑ team_id match (ranking_entries ↔ natural-key target): ${teamIdsMatch ? '✓' : '✗'}`);

// 4. Print the would-be UPDATE — nothing written.
console.log('\n' + '='.repeat(80));
console.log('INTENDED WRITE (DRY — nothing written)');
console.log('='.repeat(80));
const TARGET_URL = 'https://flagcdn.com/ar.svg';
if (target.length !== 1) {
  console.log(`  ⚠  resolved ${target.length} rows by natural key — STOP. Investigate before any write.`);
} else {
  const r = target[0];
  console.log('  WOULD UPDATE teams');
  console.log(`     SET flag_svg_path = '${TARGET_URL}'`);
  console.log(`   WHERE name = 'Argentina'`);
  console.log(`     AND league_id = (SELECT id FROM leagues WHERE slug = 'fifa-wc-2026')`);
  console.log(`     -- resolves to PROD teams.id = ${r.id} (re-resolved on PROD by natural key)`);
  console.log('');
  console.log(`  flag_svg_path:  '${r.flag_svg_path}'`);
  console.log(`               →  '${TARGET_URL}'`);
  console.log(`  delta: change blob URL to canonical flagcdn (other 47 teams already use this domain)`);
}

console.log('\nDRY-RUN COMPLETE — nothing written. Awaiting per-row go for the actual UPDATE.');
