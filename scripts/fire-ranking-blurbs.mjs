// scripts/fire-ranking-blurbs.mjs
//
// Dev-only — fires the ranking_row_blurb generator against the current
// published team-power edition. Default: rank 1 only (the first pass).
// Override with --ranks=1,2,3 to fire a wider set; --phase=in_tournament
// flips the prompt's phase mode.
//
// Discipline:
//   · Host-guard: refuses to run if DATABASE_URL hostname includes
//     winter-dawn. Mirrors fire-prematch-wc.mjs.
//   · Freeze gate: skip if a ranking_row_blurb already exists for this
//     ranking_entry_id (any status). Re-generate is an explicit DELETE
//     + re-fire by the user — never automatic.
//   · Writes via lib/blurbs.insertPendingBlurb → lands at
//     status='pending_review', is_current=false. NEVER auto-publishes.
//     Editor flips to published via the admin queue / publishBlurb.
//
// Run:
//   node scripts/fire-ranking-blurbs.mjs                    # rank 1 (Spain), pre_tournament
//   node scripts/fire-ranking-blurbs.mjs --ranks=1,2,3
//   node scripts/fire-ranking-blurbs.mjs --ranks=1 --phase=in_tournament

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

// CLI parsing.
const args = process.argv.slice(2);
const rankArg = (args.find((a) => a.startsWith('--ranks=')) ?? '--ranks=1').split('=')[1];
const phaseArg = (args.find((a) => a.startsWith('--phase=')) ?? '--phase=pre_tournament').split('=')[1];
const ranks = rankArg.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
if (ranks.length === 0) throw new Error(`Bad --ranks=${rankArg}`);
if (!['pre_tournament', 'in_tournament'].includes(phaseArg)) {
  throw new Error(`Bad --phase=${phaseArg} (use pre_tournament | in_tournament)`);
}
console.log(`ranks: [${ranks.join(', ')}]  ·  phase: ${phaseArg}`);

const { sql } = await import('../lib/db.js');
const { runRankingBlurbForEntry } = await import('../lib/aiRankingBlurb.js');
const { insertPendingBlurb } = await import('../lib/blurbs.js');

// Resolve target ranking_entry_ids for the current published team-power
// edition — same WHERE clause /power-rankings reads.
const candidates = await sql`
  SELECT e.id AS ranking_entry_id, e.rank, t.name AS team_name, t.slug AS team_slug
    FROM ranking_entries e
    JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
    JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
    JOIN leagues lg          ON lg.id = rl.league_id
    JOIN teams t             ON t.id  = e.team_id
   WHERE rl.slug = 'team-power'
     AND lg.slug = 'fifa-wc-2026'
     AND ed.is_current = true
     AND ed.status     = 'published'
     AND e.rank        = ANY(${ranks})
   ORDER BY e.rank ASC
`;
console.log(`\nmatched ${candidates.length} candidate(s) in current edition:`);
for (const c of candidates) console.log(`  rank ${c.rank.toString().padStart(2)}  ${c.team_name}  (entry_id=${c.ranking_entry_id})`);
if (candidates.length === 0) {
  console.log('Nothing to fire. Exiting.');
  process.exit(0);
}

// Fire.
const results = [];
for (const c of candidates) {
  console.log('\n' + '─'.repeat(80));
  console.log(`[rank ${c.rank}] ${c.team_name}`);

  // Freeze gate — skip if any ranking_row_blurb exists for this entry.
  const existing = await sql`
    SELECT id, status FROM editorial_blurbs
     WHERE blurb_type = 'ranking_row_blurb'
       AND ranking_entry_id = ${c.ranking_entry_id}
     LIMIT 1
  `;
  if (existing.length > 0) {
    console.log(`  SKIP (freeze) — existing blurb id=${existing[0].id}, status=${existing[0].status}`);
    results.push({ rank: c.rank, slug: c.team_slug, outcome: 'skip_exists', existing_id: existing[0].id });
    continue;
  }

  // Generate.
  const t0 = Date.now();
  const r = await runRankingBlurbForEntry(c.ranking_entry_id, { phase: phaseArg });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  if (!r.ok) {
    console.log(`  GENERATE FAILED in ${dt}s — ${r.error}`);
    results.push({ rank: c.rank, slug: c.team_slug, outcome: 'gen_failed', error: r.error });
    continue;
  }
  console.log(`  generated in ${dt}s`);
  console.log(`  word_count: ${r.validation.word_count}`);
  console.log(`  validation.ok: ${r.validation.ok}`);
  if (r.validation.issues.length > 0) {
    console.log('  issues:');
    for (const i of r.validation.issues) console.log('    · ' + i);
  }
  console.log('  name candidates extracted from body:');
  if (r.validation.name_candidates.length === 0) {
    console.log('    (none — fully unit-level)');
  } else {
    for (const nc of r.validation.name_candidates) {
      const tag = nc.grounded ? `✓ grounded (${nc.matchedAs})` : '✗ UNGROUNDED';
      console.log(`    · "${nc.candidate}"  → ${tag}`);
    }
  }
  console.log('  body:');
  console.log('    ' + r.parsed.body);

  // Write pending_review row via the canonical helper.
  // generation_input carries the envelope for audit (so the editor can
  // see what the model was handed).
  let written;
  try {
    written = await insertPendingBlurb({
      blurbType: 'ranking_row_blurb',
      entityRef: { kind: 'ranking_entry', id: c.ranking_entry_id },
      body: r.parsed.body,
      generationInput: { phase: phaseArg, envelope: r.envelope, validation: r.validation },
      generationTier: 'tier_2_draft',
    });
  } catch (err) {
    console.log(`  INSERT FAILED — ${err?.message ?? err}`);
    results.push({ rank: c.rank, slug: c.team_slug, outcome: 'insert_failed', error: String(err?.message ?? err) });
    continue;
  }
  console.log(`  ✓ INSERTED editorial_blurbs id=${written.id}, status=${written.status}`);
  results.push({
    rank: c.rank,
    slug: c.team_slug,
    outcome: 'inserted',
    blurb_id: written.id,
    status: written.status,
    word_count: r.validation.word_count,
    validation_ok: r.validation.ok,
  });
}

console.log('\n' + '='.repeat(80));
console.log('SUMMARY');
console.log('='.repeat(80));
for (const x of results) console.log('  ' + JSON.stringify(x));
console.log('\nDONE.');
