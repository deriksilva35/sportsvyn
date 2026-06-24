// scripts/fix-prod-argentina-flag-write.mjs
//
// WRITES the single-row fix for PROD's Argentina flag. Mirrors the
// dry-run companion (fix-prod-argentina-flag-dryrun.mjs) but performs
// the UPDATE inside a transaction.
//
// Discipline:
//   · Host-guard: refuses to run if PROD_DATABASE_URL doesn't include
//     winter-dawn. Credential read from env, never inlined.
//   · Natural-key resolution: UPDATE WHERE name='Argentina' + WC league.
//     The WHERE clause itself re-resolves on PROD — no DEV-derived ids.
//   · Pre-write guard: refuse if the natural key resolves to anything
//     other than 1 row. ROLLBACK if RETURNING doesn't yield exactly 1.
//   · Verify-after: re-SELECT the row + cross-check via ranking_entries
//     so the page-render path is confirmed before exit.
//
// Run:
//   PROD_DATABASE_URL="postgresql://..." node scripts/fix-prod-argentina-flag-write.mjs

import pkg from 'pg';
import { neon } from '@neondatabase/serverless';
const { Client } = pkg;

const PROD_URL = process.env.PROD_DATABASE_URL;
if (!PROD_URL) throw new Error('PROD_DATABASE_URL missing — export it in your shell, do not inline.');
const prodHost = new URL(PROD_URL).hostname;
if (!prodHost.includes('winter-dawn')) {
  throw new Error('REFUSE: PROD_DATABASE_URL does not look like PROD (winter-dawn).');
}
console.log('prod host:', prodHost);

const TARGET_URL = 'https://flagcdn.com/ar.svg';

// neon HTTP driver for reads + cross-check; pg.Client for the
// transactional UPDATE (BEGIN/COMMIT semantics so ROLLBACK works if the
// pre-write guard catches an unexpected row count).
const prod = neon(PROD_URL);
const client = new Client({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  // ─── 1. Pre-write probe: resolve natural key, confirm exactly 1 row.
  console.log('\n' + '='.repeat(80));
  console.log('PRE-WRITE PROBE');
  console.log('='.repeat(80));
  const probe = await prod`
    SELECT t.id, t.slug, t.name, t.flag_svg_path, lg.slug AS league_slug
      FROM teams t
      JOIN leagues lg ON lg.id = t.league_id
     WHERE t.name = 'Argentina'
       AND lg.slug = 'fifa-wc-2026'
  `;
  console.log(`  natural-key resolves to ${probe.length} row(s) on PROD (expected: 1)`);
  for (const r of probe) console.log('    ' + JSON.stringify(r));
  if (probe.length !== 1) {
    throw new Error(`Pre-write guard tripped: natural key resolved to ${probe.length} rows, not 1. Refusing to write.`);
  }
  const before = probe[0];
  if (before.flag_svg_path === TARGET_URL) {
    console.log('  → already at target URL, nothing to do. Exiting clean.');
    process.exit(0);
  }

  // ─── 2. Transactional UPDATE — WHERE clause re-resolves the natural key.
  console.log('\n' + '='.repeat(80));
  console.log('TRANSACTIONAL UPDATE');
  console.log('='.repeat(80));
  await client.query('BEGIN');
  const result = await client.query(
    `UPDATE teams
        SET flag_svg_path = $1,
            updated_at = now()
      WHERE name = 'Argentina'
        AND league_id = (SELECT id FROM leagues WHERE slug = 'fifa-wc-2026')
    RETURNING id, name, flag_svg_path`,
    [TARGET_URL]
  );
  console.log(`  UPDATE returned ${result.rowCount} row(s) (expected: 1)`);
  for (const r of result.rows) console.log('    ' + JSON.stringify(r));
  if (result.rowCount !== 1) {
    await client.query('ROLLBACK');
    throw new Error(`Post-UPDATE guard tripped: rowCount=${result.rowCount}, not 1. ROLLBACK fired, nothing committed.`);
  }
  await client.query('COMMIT');
  console.log('  ✓ COMMIT — write landed on PROD.');

  // ─── 3. Verify-after: SELECT confirms the new flag value.
  console.log('\n' + '='.repeat(80));
  console.log('VERIFY AFTER WRITE');
  console.log('='.repeat(80));
  const after = await prod`
    SELECT t.id, t.slug, t.name, t.flag_svg_path, lg.slug AS league_slug
      FROM teams t
      JOIN leagues lg ON lg.id = t.league_id
     WHERE t.name = 'Argentina'
       AND lg.slug = 'fifa-wc-2026'
  `;
  for (const r of after) console.log('  ' + JSON.stringify(r));
  const ok = after.length === 1 && after[0].flag_svg_path === TARGET_URL;
  console.log(`  flag_svg_path now matches target: ${ok ? '✓' : '✗'}`);

  // ─── 4. Cross-check the render path (ranking_entries → teams).
  console.log('\nCROSS-CHECK: ranking_entries → teams (the render path /rankings reads)');
  const re = await prod`
    SELECT e.rank, t.name, t.flag_svg_path
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

  // ─── 5. Confirm the friendlies sibling is unchanged.
  console.log('\nSANITY: international-friendlies sibling row (should be untouched, still flagcdn)');
  const friendly = await prod`
    SELECT t.id, t.flag_svg_path, lg.slug AS league_slug
      FROM teams t
      JOIN leagues lg ON lg.id = t.league_id
     WHERE t.name = 'Argentina'
       AND lg.slug = 'international-friendlies'
  `;
  for (const r of friendly) console.log('  ' + JSON.stringify(r));

  console.log('\nDONE.');
} finally {
  await client.end();
}
