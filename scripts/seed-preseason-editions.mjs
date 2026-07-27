// scripts/seed-preseason-editions.mjs — seed the hand-authored Edition 0 gridiron
// ranking boards from content/preseason-edition-0.md into the rankings tables.
//
//   node scripts/seed-preseason-editions.mjs            # DRY-RUN (DEV), full report
//   node scripts/seed-preseason-editions.mjs --apply    # DEV apply
//   node scripts/seed-preseason-editions.mjs --prod --apply   # PROD (holds for GO)
//
// One ranking_lists row per board per league (slug globally unique), one Edition 0
// per list (edition_number 0, Preseason, editorial_weight 1.00, sites_weight 0.00,
// is_current + published), entries carrying selection_label/team_tag/band/read
// (migration 054 — no player/team row dependency). Idempotent: re-seeding replaces
// Edition 0 for each list. Never prints a secret.
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { parsePreseasonEditions } from '../lib/gridiron/preseasonParser.js';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const readEnv = (n) => (envText.match(new RegExp('^' + n + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const url = PROD ? readEnv('PROD_DATABASE_URL') : readEnv('DATABASE_URL');
if (!url) { console.error(`REFUSE: ${PROD ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} missing`); process.exit(1); }
const sql = neon(url);

const md = readFileSync(new URL('../content/preseason-edition-0.md', import.meta.url), 'utf8');
const boards = parsePreseasonEditions(md);

// ---- DRY-RUN report (always printed) ----
console.log(`\n=== PARSED EDITION 0 (${PROD ? 'PROD' : 'DEV'} target, ${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
for (const b of boards) {
  const ranks = b.entries.map((e) => e.rank);
  const dark = b.entries.filter((e) => e.band === 'dark_horse').map((e) => e.rank);
  const rankOnly = b.entries.filter((e) => e.read == null).map((e) => e.rank);
  console.log(`\n# ${b.name}  [list=${b.slug} league=${b.league} entity=${b.entity}]  ${b.entries.length} entries`);
  console.log(`  ranks ${Math.min(...ranks)}-${Math.max(...ranks)} | dark_horse: ${dark.join(',') || '(none)'} | rank-only: ${rankOnly.join(',') || '(none)'}`);
  for (const e of b.entries) {
    const tag = e.band === 'dark_horse' ? ' [DH]' : '';
    const nm = e.teamTag ? `${e.label}, ${e.teamTag}` : e.label;
    const rd = e.read == null ? '[rank-only]' : `${e.read.slice(0, 58)}${e.read.length > 58 ? '…' : ''}`;
    console.log(`   ${String(e.rank).padStart(2)}${tag}  ${nm}  —  ${rd}`);
  }
  if (b.footer) console.log(`   FOOTER (Named and left off): ${b.footer.slice(0, 90)}…`);
}

if (!APPLY) {
  console.log('\nDRY-RUN ONLY. Re-run with --apply to write.\n');
  process.exit(0);
}

// ---- APPLY ----
const score = (rank) => Math.round((99.99 - rank) * 100) / 100; // numeric(4,2), DESC == rank order
for (const b of boards) {
  const lg = (await sql`SELECT id FROM leagues WHERE slug = ${b.league} LIMIT 1`)[0];
  if (!lg) { console.error(`REFUSE: league '${b.league}' not found`); process.exit(1); }
  const listId = (await sql`
    INSERT INTO ranking_lists (slug, name, league_id, entity_type, list_type, composite_type, is_active, display_order)
    VALUES (${b.slug}, ${b.name}, ${lg.id}, ${b.entity}, 'composite', ${b.composite}, true, 0)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, league_id = EXCLUDED.league_id,
      entity_type = EXCLUDED.entity_type, composite_type = EXCLUDED.composite_type, updated_at = now()
    RETURNING id`)[0].id;

  await sql`DELETE FROM ranking_editions WHERE ranking_list_id = ${listId} AND edition_number = 0`;
  const edId = (await sql`
    INSERT INTO ranking_editions
      (ranking_list_id, edition_number, edition_label, editorial_weight, sites_weight, user_weight, status, is_current, published_at, notes)
    VALUES (${listId}, 0, 'Preseason', 1.00, 0.00, 0.00, 'published', true, now(), ${b.footer ?? null})
    RETURNING id`)[0].id;

  for (const e of b.entries) {
    await sql`
      INSERT INTO ranking_entries
        (ranking_edition_id, entity_type, rank, score, editorial_composite, selection_label, team_tag, band, read)
      VALUES (${edId}, ${b.entity}, ${e.rank}, ${score(e.rank)}, ${score(e.rank)}, ${e.label}, ${e.teamTag}, ${e.band}, ${e.read})`;
  }
  console.log(`seeded ${b.slug}: edition ${edId}, ${b.entries.length} entries`);
}
console.log('\nDONE.\n');
