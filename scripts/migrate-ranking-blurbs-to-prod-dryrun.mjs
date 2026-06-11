// scripts/migrate-ranking-blurbs-to-prod-dryrun.mjs
//
// PROD content-load DRY-RUN — migrate the 10 reviewed DEV ranking_row_blurbs
// onto PROD's ranking_entries by natural key (team name + WC league +
// team-power list + current published edition). WRITES NOTHING.
//
// Discipline (mirrors migrate-md1-prematch-to-prod-dryrun.mjs):
//   · DEV ranking_entry_ids (105-114) are MEANINGLESS on PROD. The
//     blurb's PROD attachment is ALWAYS re-resolved by team name on
//     the PROD branch itself.
//   · Host guard: PROD_DATABASE_URL must include winter-dawn.
//     DEV connection must NOT.
//   · Refuse to proceed (in the write phase) if any team's natural key
//     resolves to anything other than 1 PROD ranking_entry, or if a
//     ranking_row_blurb already exists on PROD for that entry.
//
// Run:
//   PROD_DATABASE_URL="postgresql://..." node scripts/migrate-ranking-blurbs-to-prod-dryrun.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnvLocal(p) {
  let text;
  try { text = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvLocal(path.resolve(__dirname, '..', '.env.local'));

const DEV_URL  = process.env.DATABASE_URL;
const PROD_URL = process.env.PROD_DATABASE_URL;
if (!DEV_URL)  throw new Error('DATABASE_URL missing (DEV). Check .env.local.');
if (!PROD_URL) throw new Error('PROD_DATABASE_URL missing — export it in your shell, do not inline.');

const devHost  = new URL(DEV_URL).hostname;
const prodHost = new URL(PROD_URL).hostname;
if (devHost.includes('winter-dawn'))   throw new Error('REFUSE: DATABASE_URL points at PROD.');
if (!prodHost.includes('winter-dawn')) throw new Error('REFUSE: PROD_DATABASE_URL does not look like PROD.');
console.log('dev  host:', devHost);
console.log('prod host:', prodHost);

const dev  = neon(DEV_URL);
const prod = neon(PROD_URL);

// Read DEV's 10 pending_review ranking_row_blurbs + the team name
// they're attached to via the DEV ranking_entry → teams join. The
// team NAME is the natural key that crosses branches; the DEV
// ranking_entry_id is logged only for reference.
const devRows = await dev`
  SELECT
    b.id                          AS dev_blurb_id,
    b.body,
    b.word_count,
    b.voice_model_version,
    b.generation_tier,
    b.generation_input,
    b.ranking_entry_id             AS dev_ranking_entry_id,
    e.rank                         AS rank_on_dev,
    t.name                         AS team_name,
    t.slug                         AS team_slug
  FROM editorial_blurbs b
  JOIN ranking_entries e ON e.id = b.ranking_entry_id
  JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
  JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
  JOIN leagues lg          ON lg.id = rl.league_id
  JOIN teams t             ON t.id  = e.team_id
  WHERE b.blurb_type = 'ranking_row_blurb'
    AND b.status     = 'pending_review'
    AND rl.slug      = 'team-power'
    AND lg.slug      = 'fifa-wc-2026'
  ORDER BY e.rank ASC
`;
console.log(`\nDEV: ${devRows.length} pending_review ranking_row_blurbs to migrate.\n`);
if (devRows.length === 0) { console.log('Nothing to do.'); process.exit(0); }

// Resolve each by team name on PROD + check for collisions.
const resolved = [];
for (const d of devRows) {
  // Natural-key resolution on PROD: team name + WC league + team-power
  // list + current published edition. Must return exactly 1 row.
  const pe = await prod`
    SELECT e.id   AS prod_ranking_entry_id,
           e.rank AS prod_rank,
           t.name AS prod_team_name
      FROM ranking_entries e
      JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
      JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
      JOIN leagues lg          ON lg.id = rl.league_id
      JOIN teams t             ON t.id  = e.team_id
     WHERE t.name = ${d.team_name}
       AND rl.slug = 'team-power'
       AND lg.slug = 'fifa-wc-2026'
       AND ed.is_current = true
       AND ed.status     = 'published'
  `;
  let collision = null;
  if (pe.length === 1) {
    const c = await prod`
      SELECT id, status, is_current
        FROM editorial_blurbs
       WHERE blurb_type = 'ranking_row_blurb'
         AND ranking_entry_id = ${pe[0].prod_ranking_entry_id}
    `;
    if (c.length > 0) collision = c;
  }
  resolved.push({ dev: d, prod: pe, collision });
}

// Print the resolution table.
console.log('='.repeat(120));
console.log('NATURAL-KEY RESOLUTION (team name + WC league + team-power + current edition)');
console.log('='.repeat(120));
console.log('  team               DEV blurb  DEV rank  →  PROD entry_id  PROD rank  collision  body snippet');
console.log('  ' + '─'.repeat(116));
let resolveFails = 0;
let collisions   = 0;
for (const r of resolved) {
  const team = r.dev.team_name.padEnd(18);
  const devBlurbId = String(r.dev.dev_blurb_id).padStart(9);
  const devRank    = String(r.dev.rank_on_dev).padStart(8);
  if (r.prod.length !== 1) {
    console.log(`  ${team}  ${devBlurbId}  ${devRank}     ✗ ${r.prod.length} PROD rows resolved (expected 1)`);
    resolveFails++;
    continue;
  }
  const prodId   = String(r.prod[0].prod_ranking_entry_id).padStart(13);
  const prodRank = String(r.prod[0].prod_rank).padStart(9);
  const coll     = r.collision ? `⚠  id=${r.collision[0].id}` : 'none';
  const snippet  = (r.dev.body ?? '').slice(0, 60).replace(/\s+/g, ' ');
  if (r.collision) collisions++;
  console.log(`  ${team}  ${devBlurbId}  ${devRank}     ${prodId}  ${prodRank}  ${coll.padEnd(10)} ${snippet}…`);
}

// Flags.
console.log('\n' + '='.repeat(120));
console.log('FLAGS');
console.log('='.repeat(120));
if (resolveFails === 0) {
  console.log(`  ✓ all ${devRows.length} teams resolved cleanly to exactly 1 PROD ranking_entry`);
} else {
  console.log(`  ✗ ${resolveFails} team(s) failed natural-key resolution — STOP, do not write`);
}
if (collisions === 0) {
  console.log(`  ✓ no PROD ranking_row_blurb collisions — clean inserts in write phase`);
} else {
  console.log(`  ⚠  ${collisions} PROD entries ALREADY have a ranking_row_blurb — write phase would REPLACE/STOP per your call`);
  for (const r of resolved.filter((x) => x.collision)) {
    console.log(`     · ${r.dev.team_name}: existing PROD blurb id=${r.collision[0].id} status=${r.collision[0].status} is_current=${r.collision[0].is_current}`);
  }
}

// Intended writes summary.
console.log('\n' + '='.repeat(120));
console.log('INTENDED WRITES (DRY — nothing written this phase)');
console.log('='.repeat(120));
console.log(`  Would INSERT ${resolved.filter((r) => r.prod.length === 1 && !r.collision).length} ranking_row_blurb row(s) on PROD with:`);
console.log(`    blurb_type       = 'ranking_row_blurb'`);
console.log(`    ranking_entry_id = <RESOLVED PROD entry_id per team>`);
console.log(`    body             = <DEV body, unchanged>`);
console.log(`    status           = 'editor_approved'`);
console.log(`    is_current       = true`);
console.log(`    auto_published   = false`);
console.log(`    reviewed_at      = now()`);
console.log(`    reviewed_by      = 'admin' (or env-overridden)`);
console.log(`    voice_model_version, generation_tier, generation_input = carried from DEV`);
console.log(`    published_at     = now()`);

console.log('\nDRY-RUN COMPLETE. NOTHING WRITTEN TO PROD. Awaiting approval for the write phase.');
