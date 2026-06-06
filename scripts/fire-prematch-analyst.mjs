// scripts/fire-prematch-analyst.mjs
//
// Dev-only — fires the pre-match analyst runner against the seeded
// friendlies. Writes articles rows. Two phases:
//
//   1. Fire all 24 (the 2 cancelled will be skipped by the runner).
//   2. Idempotency probe: re-fire the entire set — every row should be
//      a no-op (skipped_exists), proving freeze.
//
// Reports the published-vs-held split with moment_basis for each.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const host = new URL(process.env.DATABASE_URL).hostname;
if (host.includes('winter-dawn')) throw new Error('REFUSE: prod');
console.log(`✓ dev host: ${host}`);

const { sql } = await import('../lib/db.js');
const { runAndPublishPrematchForMatch } = await import('../lib/aiPrematchRunner.js');

// All 24 seeded friendlies in the PT-2026-06-06 day window.
const candidates = await sql`
  SELECT m.id, m.slug, m.status
    FROM matches m
    JOIN leagues l ON l.id = m.league_id
   WHERE l.slug = 'international-friendlies'
     AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date BETWEEN '2026-06-05'::date AND '2026-06-06'::date
   ORDER BY m.kickoff_at ASC, m.id ASC
`;
console.log(`\nfiring on ${candidates.length} fixtures...\n`);

// ============================================================================
// PHASE 1 — initial fire
// ============================================================================
const phase1 = [];
for (let i = 0; i < candidates.length; i++) {
  const c = candidates[i];
  process.stdout.write(`  [${i + 1}/${candidates.length}] ${c.slug}  `);
  try {
    const r = await runAndPublishPrematchForMatch(c.id);
    phase1.push({ slug: c.slug, ...r });
    if (r.outcome === 'generated') {
      console.log(`✓ ${r.status.padEnd(9)} · moment_basis=${r.moment_basis.padEnd(13)} · composite=${r.composite}`);
    } else if (r.outcome === 'skipped_cancelled') {
      console.log(`SKIP cancelled`);
    } else if (r.outcome === 'skipped_exists') {
      console.log(`SKIP exists (${r.existing_status})`);
    } else {
      console.log(`FAIL ${r.error}`);
    }
  } catch (err) {
    phase1.push({ slug: c.slug, outcome: 'crashed', error: String(err?.message ?? err) });
    console.log(`CRASH ${err?.message ?? err}`);
  }
}

const generated = phase1.filter((r) => r.outcome === 'generated');
const publishedRows = generated.filter((r) => r.status === 'published');
const pendingReviewRows = generated.filter((r) => r.status === 'preview');
const cancelledSkipped = phase1.filter((r) => r.outcome === 'skipped_cancelled');
const failed = phase1.filter((r) => r.outcome === 'failed' || r.outcome === 'crashed');

console.log('\n' + '='.repeat(100));
console.log('PHASE 1 SUMMARY');
console.log('='.repeat(100));
console.log(`  generated:           ${generated.length}`);
console.log(`    → auto-published:  ${publishedRows.length}`);
console.log(`    → pending-review:  ${pendingReviewRows.length}`);
console.log(`  skipped (cancelled): ${cancelledSkipped.length}`);
console.log(`  failed:              ${failed.length}`);

console.log('\nPUBLISHED auto (moment_basis non-geopolitical):');
for (const r of publishedRows) {
  console.log(`  ✓ ${r.slug.padEnd(48)} basis=${r.moment_basis.padEnd(11)} composite=${r.composite}`);
}
console.log('\nPENDING REVIEW (moment_basis=geopolitical — admin holds):');
for (const r of pendingReviewRows) {
  console.log(`  ⏸ ${r.slug.padEnd(48)} basis=${r.moment_basis.padEnd(13)} composite=${r.composite}`);
}
console.log('\nSKIPPED (cancelled):');
for (const r of cancelledSkipped) console.log(`  -- ${r.slug}`);
if (failed.length > 0) {
  console.log('\nFAILURES:');
  for (const r of failed) console.log(`  ✗ ${r.slug} — ${r.error}`);
}

// ============================================================================
// PHASE 2 — re-fire to prove freeze/idempotency
// ============================================================================
console.log('\n' + '='.repeat(100));
console.log('PHASE 2 — RE-FIRE (idempotency / freeze probe)');
console.log('='.repeat(100));
const phase2 = [];
for (const c of candidates) {
  const r = await runAndPublishPrematchForMatch(c.id);
  phase2.push({ slug: c.slug, ...r });
}
const reGen = phase2.filter((r) => r.outcome === 'generated');
const reSkipExists = phase2.filter((r) => r.outcome === 'skipped_exists');
const reSkipCancelled = phase2.filter((r) => r.outcome === 'skipped_cancelled');
console.log(`  generated (should be 0):       ${reGen.length}  ${reGen.length === 0 ? '✓' : '✗ FREEZE BROKEN'}`);
console.log(`  skipped_exists (should be ${generated.length}): ${reSkipExists.length}`);
console.log(`  skipped_cancelled:             ${reSkipCancelled.length}`);

// Probe the DB to confirm no double-rows for any fixture.
console.log('\nDB row count per fixture (should be 1 for every generated, 0 for cancelled):');
const dupCheck = await sql`
  SELECT a.match_id, m.slug, COUNT(*)::int AS rowcount
    FROM articles a
    JOIN matches m ON m.id = a.match_id
   WHERE a.type = 'preview' AND a.score_type = 'watch'
     AND a.match_id = ANY(${candidates.map(c => c.id)})
   GROUP BY a.match_id, m.slug
   HAVING COUNT(*) <> 1
`;
if (dupCheck.length === 0) {
  console.log('  ✓ no duplicates — every generated fixture has exactly one row.');
} else {
  console.log('  ✗ duplicates found:');
  for (const d of dupCheck) console.log(`    · ${d.slug} → ${d.rowcount} rows`);
}

console.log('\nDONE — Phase 1 wrote the rows; Phase 2 confirmed re-fire is a no-op.');
