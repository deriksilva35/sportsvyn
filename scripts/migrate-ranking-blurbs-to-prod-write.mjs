// scripts/migrate-ranking-blurbs-to-prod-write.mjs
//
// WRITES the 10 reviewed DEV ranking_row_blurbs onto PROD by natural
// key (team name + WC league + team-power list + current published
// edition). Mirrors the dry-run companion, performs the inserts inside
// a transaction.
//
// Discipline:
//   · Host-guard: refuse if PROD_DATABASE_URL doesn't include winter-dawn.
//   · Natural-key resolution AT WRITE TIME — DEV ranking_entry_ids are
//     never trusted on PROD. Each row's PROD ranking_entry_id is
//     re-resolved by team name immediately before the INSERT.
//   · Pre-write guard: refuse + ROLLBACK if ANY team fails to resolve
//     to exactly 1 PROD ranking_entry, or if ANY PROD entry already
//     carries a ranking_row_blurb (collision).
//   · Transactional: BEGIN → resolve+insert all 10 → verify count=10 →
//     COMMIT. ROLLBACK on any guard trip.
//   · Each INSERT sets status='editor_approved', is_current=true,
//     auto_published=false, reviewed_at=now(), published_at=now(),
//     reviewed_by per env REVIEWED_BY (default 'admin'). Body +
//     voice_model_version + generation_tier + generation_input carried
//     from DEV unchanged.
//
// Run:
//   PROD_DATABASE_URL="postgresql://..." node scripts/migrate-ranking-blurbs-to-prod-write.mjs

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import pkg from 'pg';
const { Client } = pkg;

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
const REVIEWED_BY = process.env.REVIEWED_BY ?? 'admin';
if (!DEV_URL)  throw new Error('DATABASE_URL missing (DEV). Check .env.local.');
if (!PROD_URL) throw new Error('PROD_DATABASE_URL missing — export it in your shell, do not inline.');
const devHost  = new URL(DEV_URL).hostname;
const prodHost = new URL(PROD_URL).hostname;
if (devHost.includes('winter-dawn'))   throw new Error('REFUSE: DATABASE_URL points at PROD.');
if (!prodHost.includes('winter-dawn')) throw new Error('REFUSE: PROD_DATABASE_URL does not look like PROD.');
console.log('dev  host:', devHost);
console.log('prod host:', prodHost);
console.log('reviewed_by:', REVIEWED_BY);

const dev      = neon(DEV_URL);
const prodRead = neon(PROD_URL);
const client   = new Client({ connectionString: PROD_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  // 1. Read DEV's 10 pending_review ranking_row_blurbs + team name.
  const devRows = await dev`
    SELECT
      b.id                  AS dev_blurb_id,
      b.body,
      b.voice_model_version,
      b.generation_tier,
      b.generation_input,
      e.rank                AS rank_on_dev,
      t.name                AS team_name
    FROM editorial_blurbs b
    JOIN ranking_entries e   ON e.id = b.ranking_entry_id
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
  console.log(`\nDEV: ${devRows.length} pending_review ranking_row_blurbs to migrate.`);
  if (devRows.length === 0) { console.log('Nothing to do.'); process.exit(0); }

  // 2. Pre-write probe — re-resolve every team + collision-check on PROD.
  console.log('\n' + '='.repeat(80));
  console.log('PRE-WRITE PROBE');
  console.log('='.repeat(80));
  const targets = [];
  let probeFails = 0;
  for (const d of devRows) {
    const pe = await prodRead`
      SELECT e.id, e.rank
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
    if (pe.length !== 1) {
      console.log(`  ✗ ${d.team_name}: PROD resolved ${pe.length} rows (expected 1)`);
      probeFails++;
      continue;
    }
    const coll = await prodRead`
      SELECT id FROM editorial_blurbs
       WHERE blurb_type = 'ranking_row_blurb'
         AND ranking_entry_id = ${pe[0].id}
       LIMIT 1
    `;
    if (coll.length > 0) {
      console.log(`  ✗ ${d.team_name}: PROD already has ranking_row_blurb id=${coll[0].id}`);
      probeFails++;
      continue;
    }
    targets.push({
      team_name: d.team_name,
      rank: d.rank_on_dev,
      prod_ranking_entry_id: pe[0].id,
      body: d.body,
      voice_model_version: d.voice_model_version,
      generation_tier: d.generation_tier,
      generation_input: d.generation_input,
    });
    console.log(`  ✓ ${d.team_name.padEnd(14)} → PROD ranking_entry_id=${pe[0].id} (rank ${pe[0].rank})`);
  }
  if (probeFails > 0) {
    throw new Error(`Pre-write probe failed for ${probeFails} team(s). Refusing to write.`);
  }
  if (targets.length !== devRows.length) {
    throw new Error(`Pre-write target count ${targets.length} != DEV count ${devRows.length}. Refusing to write.`);
  }

  // 3. Transactional INSERT.
  console.log('\n' + '='.repeat(80));
  console.log('TRANSACTIONAL INSERT');
  console.log('='.repeat(80));
  await client.query('BEGIN');

  const inserted = [];
  for (const t of targets) {
    const r = await client.query(
      `INSERT INTO editorial_blurbs (
         blurb_type, ranking_entry_id,
         body, voice_model_version, generation_tier, generation_input,
         status, is_current, auto_published,
         reviewed_at, reviewed_by, published_at
       ) VALUES (
         'ranking_row_blurb', $1,
         $2, $3, $4, $5::jsonb,
         'editor_approved', true, false,
         now(), $6, now()
       )
       RETURNING id, status, is_current, ranking_entry_id`,
      [
        t.prod_ranking_entry_id,
        t.body,
        t.voice_model_version ?? '1.0',
        t.generation_tier     ?? 'tier_2_draft',
        t.generation_input ? JSON.stringify(t.generation_input) : null,
        REVIEWED_BY,
      ]
    );
    if (r.rowCount !== 1) {
      await client.query('ROLLBACK');
      throw new Error(`INSERT for ${t.team_name} returned rowCount=${r.rowCount}; ROLLBACK fired.`);
    }
    inserted.push({ team: t.team_name, rank: t.rank, ...r.rows[0] });
    console.log(`  ✓ ${t.team_name.padEnd(14)} → PROD editorial_blurbs id=${r.rows[0].id}`);
  }

  // 4. Verify count before commit.
  const verifyCount = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM editorial_blurbs b
       JOIN ranking_entries e ON e.id = b.ranking_entry_id
       JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
       JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
       JOIN leagues lg          ON lg.id = rl.league_id
      WHERE b.blurb_type = 'ranking_row_blurb'
        AND b.status     = 'editor_approved'
        AND b.is_current = true
        AND rl.slug = 'team-power'
        AND lg.slug = 'fifa-wc-2026'
        AND ed.is_current = true
        AND ed.status     = 'published'`
  );
  const finalCount = verifyCount.rows[0].n;
  console.log(`\nPROD ranking_row_blurb count (editor_approved + is_current, current edition): ${finalCount}`);
  if (finalCount !== targets.length) {
    await client.query('ROLLBACK');
    throw new Error(`Final count ${finalCount} != expected ${targets.length}; ROLLBACK fired.`);
  }

  await client.query('COMMIT');
  console.log('  ✓ COMMIT — all 10 ranking_row_blurbs landed on PROD.');

  // 5. Render-path cross-check.
  console.log('\n' + '='.repeat(80));
  console.log('RENDER PATH CROSS-CHECK (the JOIN /power-rankings reads)');
  console.log('='.repeat(80));
  const render = await prodRead`
    SELECT e.rank, t.name, LEFT(b.body, 60) AS body_snip
      FROM ranking_entries e
      JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
      JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
      JOIN leagues lg          ON lg.id = rl.league_id
      JOIN teams t             ON t.id  = e.team_id
      LEFT JOIN editorial_blurbs b
             ON b.ranking_entry_id = e.id
            AND b.blurb_type = 'ranking_row_blurb'
            AND b.status     = 'editor_approved'
            AND b.is_current = true
     WHERE rl.slug = 'team-power' AND lg.slug = 'fifa-wc-2026'
       AND ed.is_current = true AND ed.status = 'published'
       AND e.rank <= 10
     ORDER BY e.rank ASC
  `;
  for (const r of render) {
    const tag = r.body_snip ? '✓' : '✗ NO BLURB';
    console.log(`  ${String(r.rank).padStart(2)}  ${tag}  ${r.name.padEnd(14)}  ${r.body_snip ?? ''}…`);
  }

  console.log('\nDONE.');
} finally {
  await client.end();
}
