// scripts/test-blurbs-roundtrip.mjs
//
// DEV-only end-to-end exercise of lib/blurbs.js. Inserts synthetic
// team_outlook rows, walks them through the approve / supersede / reject
// gate, then deletes them so editorial_blurbs is empty for the real
// Piece 2 generation run.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnvLocal(p) {
  let text; try { text = readFileSync(p, 'utf8'); } catch { return; }
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
if (host.includes('winter-dawn')) { console.error('REFUSE — PROD host, this is a DEV test:', host); process.exit(1); }
console.log('✓ DEV host:', host);

const { sql } = await import('../lib/db.js');
const {
  insertPendingBlurb, getPendingBlurbs, getCurrentBlurb, getRecentlyReviewed,
  publishBlurb, rejectBlurb,
} = await import('../lib/blurbs.js');

function assert(label, cond, detail = '') {
  if (cond) console.log('  ✓ ' + label + (detail ? ' — ' + detail : ''));
  else      console.log('  ✗ ' + label + (detail ? ' — ' + detail : ''));
  if (!cond) process.exitCode = 1;
}

console.log('\n━━━━ baseline ━━━━');
const tbl0 = (await sql`SELECT count(*)::int AS n FROM editorial_blurbs`)[0].n;
console.log('  editorial_blurbs rows BEFORE: ' + tbl0);

// Pick a real DEV team.
const tRow = (await sql`SELECT id, slug, name FROM teams ORDER BY id LIMIT 1`)[0];
console.log('  test team: ' + JSON.stringify(tRow));

console.log('\n━━━━ STEP 1 — insertPendingBlurb (A) ━━━━');
const A = await insertPendingBlurb({
  blurbType: 'team_outlook',
  entityRef: { kind: 'team', id: tRow.id },
  body: 'TEST PARAGRAPH A1. This is the first synthetic team_outlook for the round-trip test.\n\nTEST PARAGRAPH A2. The body deliberately has two paragraphs so we can confirm the queue renders them correctly.',
  generationInput: { test: true, key_phrase: 'round-trip test A', validation: { ok: true, word_count: 38 } },
});
console.log('  inserted id=' + A.id + ' status=' + A.status + ' is_current=' + A.is_current + ' word_count=' + A.word_count);
assert('inserted as pending_review', A.status === 'pending_review');
assert('inserted as not current',    A.is_current === false);
assert('correct team_id',            A.team_id === tRow.id);
assert('word_count column populated',A.word_count != null && A.word_count > 0);

console.log('\n━━━━ STEP 2 — getPendingBlurbs sees A ━━━━');
const pending1 = await getPendingBlurbs({ blurbType: 'team_outlook' });
console.log('  pending count: ' + pending1.length);
const seen = pending1.find(r => r.id === A.id);
assert('A appears in queue',      !!seen);
assert('entity_name resolved',     seen?.entity_name === tRow.name);
assert('entity_slug resolved',     seen?.entity_slug === tRow.slug);
assert('entity_kind = team',       seen?.entity_kind === 'team');

console.log('\n━━━━ STEP 3 — publishBlurb(A) ━━━━');
const Apub = await publishBlurb({ id: A.id, reviewedBy: 'roundtrip-test' });
console.log('  result: ' + JSON.stringify({ id: Apub?.id, status: Apub?.status, is_current: Apub?.is_current, supersedes_id: Apub?.supersedes_id, published_at: !!Apub?.published_at, reviewed_at: !!Apub?.reviewed_at, reviewed_by: Apub?.reviewed_by }));
assert('A now status=editor_approved', Apub?.status === 'editor_approved');
assert('A now is_current=true',         Apub?.is_current === true);
assert('A.supersedes_id NULL (first publish)', Apub?.supersedes_id == null);
assert('A.published_at set',            !!Apub?.published_at);
assert('A.reviewed_at set',             !!Apub?.reviewed_at);
assert('A.reviewed_by recorded',        Apub?.reviewed_by === 'roundtrip-test');
assert('A.auto_published=false',        Apub?.auto_published === false);

console.log('\n━━━━ STEP 4 — getCurrentBlurb returns A ━━━━');
const cur1 = await getCurrentBlurb({ blurbType: 'team_outlook', teamId: tRow.id });
console.log('  getCurrentBlurb id=' + cur1?.id);
assert('getCurrentBlurb returns A', cur1?.id === A.id);
assert('A no longer in pending list', !(await getPendingBlurbs({ blurbType: 'team_outlook' })).some(r => r.id === A.id));

console.log('\n━━━━ STEP 5 — insert B (same team+type), publish B → A demoted ━━━━');
const B = await insertPendingBlurb({
  blurbType: 'team_outlook',
  entityRef: { kind: 'team', id: tRow.id },
  body: 'TEST PARAGRAPH B1. Second synthetic — should supersede A on approval.\n\nTEST PARAGRAPH B2. Confirms the partial UNIQUE invariant holds across the demote/promote.',
  generationInput: { test: true, key_phrase: 'round-trip test B' },
});
console.log('  inserted B id=' + B.id);

const Bpub = await publishBlurb({ id: B.id, reviewedBy: 'roundtrip-test' });
const Anow = (await sql`SELECT id, status, is_current, supersedes_id FROM editorial_blurbs WHERE id = ${A.id}`)[0];
console.log('  after publish(B): A=' + JSON.stringify(Anow) + '  B=' + JSON.stringify({ id: Bpub?.id, status: Bpub?.status, is_current: Bpub?.is_current, supersedes_id: Bpub?.supersedes_id }));
assert('A demoted to is_current=false',  Anow.is_current === false);
assert('A status=superseded',            Anow.status === 'superseded');
assert('B now is_current=true',          Bpub?.is_current === true);
assert('B status=editor_approved',       Bpub?.status === 'editor_approved');
assert('B.supersedes_id = A.id',         Bpub?.supersedes_id === A.id);

console.log('\n━━━━ STEP 6 — partial UNIQUE invariant (exactly one current per (team, type)) ━━━━');
const currentCount = (await sql`SELECT count(*)::int AS n FROM editorial_blurbs WHERE blurb_type = 'team_outlook' AND team_id = ${tRow.id} AND is_current = true`)[0].n;
console.log('  is_current=true rows for (team=' + tRow.id + ', type=team_outlook): ' + currentCount);
assert('exactly one current row',        currentCount === 1);
const cur2 = await getCurrentBlurb({ blurbType: 'team_outlook', teamId: tRow.id });
assert('getCurrentBlurb returns B',      cur2?.id === B.id);

console.log('\n━━━━ STEP 7 — reject path: insert C, rejectBlurb(C) ━━━━');
const C = await insertPendingBlurb({
  blurbType: 'team_outlook',
  entityRef: { kind: 'team', id: tRow.id },
  body: 'TEST PARAGRAPH C1. Third synthetic — to be rejected.\n\nTEST PARAGRAPH C2. Should not become current; reject path should record editor_notes.',
});
console.log('  inserted C id=' + C.id);
const Crej = await rejectBlurb({ id: C.id, reviewedBy: 'roundtrip-test', notes: 'rejected as part of round-trip test' });
console.log('  rejected: ' + JSON.stringify({ id: Crej?.id, status: Crej?.status, is_current: Crej?.is_current, editor_notes: Crej?.editor_notes, reviewed_by: Crej?.reviewed_by }));
assert('C status=rejected',         Crej?.status === 'rejected');
assert('C is_current=false',         Crej?.is_current === false);
assert('C editor_notes recorded',   Crej?.editor_notes === 'rejected as part of round-trip test');
assert('C reviewed_by recorded',    Crej?.reviewed_by === 'roundtrip-test');
assert('current is still B (not C)', (await getCurrentBlurb({ blurbType: 'team_outlook', teamId: tRow.id }))?.id === B.id);

console.log('\n━━━━ STEP 8 — Recently Reviewed shows A, B, C ━━━━');
const recent = await getRecentlyReviewed({ limit: 10 });
const recentIds = recent.map(r => r.id);
console.log('  recent ids: ' + JSON.stringify(recentIds));
assert('Recently Reviewed includes A', recentIds.includes(A.id));
assert('Recently Reviewed includes B', recentIds.includes(B.id));
assert('Recently Reviewed includes C', recentIds.includes(C.id));

console.log('\n━━━━ STEP 9 — clean up synthetic rows ━━━━');
const del = (await sql`DELETE FROM editorial_blurbs WHERE id IN (${A.id}, ${B.id}, ${C.id})`).length;
const tblF = (await sql`SELECT count(*)::int AS n FROM editorial_blurbs`)[0].n;
console.log('  editorial_blurbs rows AFTER cleanup: ' + tblF + '   (deleted: ' + del + ' or rowCount unavailable on neon HTTP)');
assert('table empty after cleanup', tblF === tbl0);

console.log('\n━━━━ END ━━━━');
