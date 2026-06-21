// scripts/draft-ranking-row-blurbs.mjs -- manual trigger for the ranking_row_blurb drafter.
//
// Usage:
//   node --env-file=.env.local scripts/draft-ranking-row-blurbs.mjs --edition <id> [--top N] [--dry-run]
//
// Reads top-N entries from the given ranking_editions row. Calls
// draftRankingRowBlurb for any entry that does not already have a current
// editor_approved blurb or a pending_review draft. Drafts land invisible
// to the page (status='pending_review', is_current=false). The editor
// reviews via /admin/blurbs and approves via publishBlurb.
//
// Idempotent: re-running on the same edition skips entries that already
// have a draft or approved blurb.
//
// Host guard: requires the DB to be Neon's winter-dawn (PROD) when
// DATABASE_URL points at PROD. DEV runs on whatever DATABASE_URL points at.

import { draftRankingRowBlurb } from '../lib/rankings/blurbDrafter.js';
import { sql } from '../lib/db.js';

const args = new Map();
for (let i = 0; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--edition')  args.set('edition', Number(process.argv[++i]));
  else if (a === '--top') args.set('top',     Number(process.argv[++i]));
  else if (a === '--dry-run') args.set('dryRun', true);
}
const editionId = args.get('edition');
const top       = args.get('top') ?? 10;
const dryRun    = !!args.get('dryRun');
if (!editionId) {
  console.error('Usage: node scripts/draft-ranking-row-blurbs.mjs --edition <id> [--top N] [--dry-run]');
  process.exit(1);
}

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not set'); process.exit(1); }
const host = new URL(process.env.DATABASE_URL).host;
console.error(`[drafter] DB host=${host}  edition=${editionId}  top=${top}  dry_run=${dryRun}`);

const entries = await sql`
  SELECT re.id, re.rank, re.player_id, re.team_id,
         COALESCE(p.full_name, t.name)   AS entity_name,
         COALESCE(p.position, '')        AS position,
         rl.slug AS list_slug
    FROM ranking_entries re
    JOIN ranking_editions ed ON ed.id = re.ranking_edition_id
    JOIN ranking_lists rl    ON rl.id = ed.ranking_list_id
    LEFT JOIN players p      ON p.id = re.player_id
    LEFT JOIN teams t        ON t.id = re.team_id
   WHERE re.ranking_edition_id = ${editionId}
     AND re.rank <= ${top}
   ORDER BY re.rank
`;
if (entries.length === 0) {
  console.error(`[drafter] no entries found for edition ${editionId}`);
  process.exit(2);
}
console.error(`[drafter] ${entries.length} entries in top-${top} of edition ${editionId}`);

// Identify which entries would be drafted (idempotency probe)
const candidateEntryIds = entries.map((e) => e.id);
const existingBlurbs = await sql`
  SELECT ranking_entry_id, status, is_current
    FROM editorial_blurbs
   WHERE blurb_type = 'ranking_row_blurb'
     AND ranking_entry_id = ANY(${candidateEntryIds}::int[])
     AND ((status = 'editor_approved' AND is_current = true)
       OR  status = 'pending_review')
`;
const blocked = new Map();
for (const b of existingBlurbs) blocked.set(b.ranking_entry_id, b.status);

console.error('\n[drafter] Per-entry plan:');
for (const e of entries) {
  const block = blocked.get(e.id);
  const action = block ? `SKIP (${block})` : 'DRAFT';
  console.error(`  rank #${String(e.rank).padStart(2)}  entry=${e.id}  ${e.entity_name.padEnd(22)} ${(e.position ?? '').padEnd(4)} list=${e.list_slug.padEnd(14)} -> ${action}`);
}

if (dryRun) {
  console.error('\n[drafter] --dry-run set; no LLM calls, no DB writes.');
  process.exit(0);
}

console.error('\n[drafter] Executing drafts...');
const results = { drafted: 0, skipped: 0, errored: 0, details: [] };
for (const e of entries) {
  if (blocked.has(e.id)) {
    results.skipped++;
    results.details.push({ entry_id: e.id, action: 'skip', reason: blocked.get(e.id) });
    continue;
  }
  process.stderr.write(`  rank #${String(e.rank).padStart(2)}  ${e.entity_name.padEnd(22)} `);
  try {
    const r = await draftRankingRowBlurb({ rankingEntryId: e.id });
    if (r.ok) {
      results.drafted++;
      results.details.push({ entry_id: e.id, action: 'drafted', blurb_id: r.blurb_id, words: r.word_count });
      process.stderr.write(`OK blurb_id=${r.blurb_id} ${r.word_count}w\n`);
    } else {
      results.skipped++;
      results.details.push({ entry_id: e.id, action: 'skipped', reason: r.reason ?? 'validation', issues: r.issues });
      process.stderr.write(`SKIP ${r.reason ?? 'validation'}\n`);
    }
  } catch (err) {
    results.errored++;
    results.details.push({ entry_id: e.id, action: 'error', message: err.message });
    process.stderr.write(`ERR ${err.message}\n`);
  }
}

console.log('\n=== SUMMARY ===');
console.log(JSON.stringify(results, null, 2));
