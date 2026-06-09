// scripts/test-team-outlook.mjs
//
// DEV-only generation of 3 contrasting team_outlook drafts. Pre-tournament
// variant. Lands as status='pending_review' — does NOT auto-publish.
// Inspect at /admin/blurbs after.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(path.resolve(__dirname, '..', '.env.local'));

const host = new URL(process.env.DATABASE_URL).hostname;
if (host.includes('winter-dawn')) { console.error('REFUSE — PROD host:', host); process.exit(1); }
if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY missing'); process.exit(1); }
console.log('✓ DEV host:', host);

const { sql } = await import('../lib/db.js');
const { runTeamOutlookForTeam } = await import('../lib/teamOutlook.js');

// Pick teams: top (rank 1), mid (~rank 16), low (rank 48).
const slots = [
  { label: 'TOP',  pickRank: 1  },
  { label: 'MID',  pickRank: 16 },
  { label: 'LOW',  pickRank: 48 },
];

console.log('\n━━━ picking 3 contrasting WC 2026 teams from DEV ━━━');
const picked = [];
for (const slot of slots) {
  const r = await sql`
    SELECT e.rank, e.score::float AS score, t.id, t.slug, t.name
      FROM ranking_entries e
      JOIN ranking_editions ed ON ed.id = e.ranking_edition_id
      JOIN ranking_lists rl ON rl.id = ed.ranking_list_id
      JOIN leagues lg ON lg.id = rl.league_id
      JOIN teams t ON t.id = e.team_id
     WHERE rl.slug = 'team-power' AND lg.slug = 'fifa-wc-2026'
       AND ed.is_current = true AND ed.status = 'published'
       AND e.rank = ${slot.pickRank}
     LIMIT 1`;
  if (r.length === 0) { console.error('no team at rank ' + slot.pickRank); process.exit(2); }
  picked.push({ ...slot, ...r[0] });
}
for (const p of picked) console.log('  ' + p.label.padEnd(3) + ' rank=' + p.rank + '  ' + p.name + '  score=' + p.score);

console.log('\n━━━ pre-state: editorial_blurbs ━━━');
const before = (await sql`SELECT count(*)::int AS n FROM editorial_blurbs`)[0].n;
console.log('  rows: ' + before);

for (const p of picked) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(p.label + ' — ' + p.name + ' (rank ' + p.rank + ', score ' + p.score + ')');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const r = await runTeamOutlookForTeam({ teamId: p.id });
  if (!r.ok) {
    console.error('  ✗ generation failed: ' + r.error);
    if (r.raw) console.error('  raw[:400]: ' + (r.raw ?? '').slice(0, 400));
    continue;
  }
  console.log('\n  --- envelope summary ---');
  console.log('  ranking:        ' + JSON.stringify(r.envelope.current_state.ranking));
  console.log('  group_code:     ' + r.envelope.entity.group_code);
  console.log('  next_event:     ' + JSON.stringify(r.envelope.context.next_event));
  console.log('  group opponents:' + JSON.stringify(r.envelope.context.group_opponents));
  console.log('  squad total:    ' + r.envelope.squad_composition.total + '   by_pos: ' + JSON.stringify(r.envelope.squad_composition.by_position));
  console.log('  attempts:       ' + r.attempts);

  console.log('\n  --- VALIDATION ---');
  console.log('  ok:             ' + r.validation.ok);
  console.log('  word_counts:    p1=' + r.validation.word_counts.p1 + '  p2=' + r.validation.word_counts.p2 + '  total=' + r.validation.word_counts.total);
  if (!r.validation.ok) {
    console.log('  issues:');
    for (const iss of r.validation.issues) console.log('    · ' + iss);
  }

  console.log('\n  --- STORED ROW ---');
  console.log('  id:             ' + r.row.id);
  console.log('  status:         ' + r.row.status + '   (expect pending_review)');
  console.log('  is_current:     ' + r.row.is_current + '   (expect false)');
  console.log('  key_phrase:     ' + (r.parsed.key_phrase ?? '—'));
  console.log('  freshness_hrs:  ' + (r.parsed.estimated_freshness_hours ?? '—'));
  console.log('  self_check:     ' + (r.parsed.self_check ?? '—'));

  console.log('\n  --- BODY (pending_review, not yet published) ---');
  console.log('\n  ' + r.parsed.p1);
  console.log('\n  ' + r.parsed.p2);
  console.log('');
}

console.log('\n━━━ final state ━━━');
const after = await sql`
  SELECT id, blurb_type, team_id, status, is_current,
         (SELECT name FROM teams WHERE id = b.team_id) AS team_name,
         word_count
    FROM editorial_blurbs b ORDER BY id`;
for (const r of after) console.log('  ' + JSON.stringify(r));
console.log('  total: ' + after.length + '   (expect 3 pending_review rows, one per picked team)');
