// scripts/migrate-md1-prematch-to-prod-dryrun.mjs
//
// PROD content-load DRY-RUN — Path B: migrate the 8 reviewed MD1 preview
// rows from DEV (rough-mouse) to PROD (winter-dawn) BY NATURAL KEY
// (match slug). WRITES NOTHING. Reads only. Prints the would-do table
// for per-row sign-off; Phase 2 actually writes.
//
// Discipline enforced here (the 14-wrong-country rule + hardened cross-
// branch write rule):
//   · Identity = match slug, resolved on the PROD branch itself.
//   · NEVER trust a DEV match_id or DEV article.id on PROD — they aren't
//     aligned across Neon branches.
//   · Any slug that fails to resolve on PROD → reported, no guess.
//   · PROD credentials read from PROD_DATABASE_URL env. Never inlined.
//   · Host guards: DEV connection must NOT be winter-dawn; PROD
//     connection MUST be winter-dawn. Either inverted → throw.
//
// Run:
//   PROD_DATABASE_URL="postgresql://..." node scripts/migrate-md1-prematch-to-prod-dryrun.mjs
//
// The DEV URL is read from .env.local (DATABASE_URL) the same way the
// other scripts do.

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
if (devHost.includes('winter-dawn'))   throw new Error('REFUSE: DATABASE_URL points at PROD (winter-dawn). DEV connection must not be winter-dawn.');
if (!prodHost.includes('winter-dawn')) throw new Error('REFUSE: PROD_DATABASE_URL does not look like PROD (winter-dawn).');
console.log('dev  host:', devHost);
console.log('prod host:', prodHost);

const dev  = neon(DEV_URL);
const prod = neon(PROD_URL);

// MD1 window — Jun 11–13 PT, fifa-wc-2026 group stage. Pull every
// approved preview row in that window from DEV. This is the source set.
const devRows = await dev`
  SELECT
    a.id           AS dev_article_id,
    a.slug         AS article_slug,
    a.title, a.subtitle, a.body, a.watch_summary,
    a.stakes_score, a.quality_score, a.narrative_score, a.drama_score, a.moment_score,
    a.composite_score,
    a.stakes_note, a.quality_note, a.narrative_note, a.drama_note, a.moment_note,
    a.moment_basis, a.status, a.published_at, a.edited_at, a.author, a.score_type, a.type,
    m.slug         AS match_slug,
    m.kickoff_at,
    to_char((m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date, 'YYYY-MM-DD') AS pt_day
  FROM articles a
  JOIN matches m ON m.id = a.match_id
  JOIN leagues l ON l.id = m.league_id
  WHERE a.type='preview' AND a.score_type='watch'
    AND l.slug = 'fifa-wc-2026'
    AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date BETWEEN '2026-06-11'::date AND '2026-06-13'::date
  ORDER BY m.kickoff_at ASC
`;
console.log(`\nDEV: found ${devRows.length} reviewed MD1 preview row(s) in fifa-wc-2026.`);

if (devRows.length === 0) {
  console.log('Nothing to migrate. Exiting.');
  process.exit(0);
}

// Resolve each DEV match_slug → PROD match_id ON THE PROD BRANCH.
// Also check whether PROD already has a preview row for that match
// (freeze collision — caller decides skip vs replace per-row).
console.log('\nResolving slugs on PROD + checking for existing preview rows...');
const resolved = [];
for (const r of devRows) {
  const prodMatch = await prod`
    SELECT m.id AS prod_match_id, l.slug AS league_slug
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
     WHERE m.slug = ${r.match_slug}
       AND l.slug = 'fifa-wc-2026'
     LIMIT 1
  `;
  let prodMatchId = null;
  let prodExisting = null;
  if (prodMatch.length > 0) {
    prodMatchId = prodMatch[0].prod_match_id;
    const exists = await prod`
      SELECT id, status, moment_basis, composite_score::float AS composite, edited_at
        FROM articles
       WHERE match_id = ${prodMatchId}
         AND type='preview' AND score_type='watch'
       LIMIT 1
    `;
    prodExisting = exists[0] ?? null;
  }
  resolved.push({ dev: r, prodMatchId, prodExisting });
}

// Print the resolution table.
console.log('\n' + '='.repeat(130));
console.log('SLUG RESOLUTION + PROD EXISTING-ROW CHECK');
console.log('='.repeat(130));
console.log('  match slug                                 PROD found  PROD match_id  PROD existing preview');
console.log('  ' + '─'.repeat(126));
for (const r of resolved) {
  const slug = r.dev.match_slug.padEnd(42);
  const found = (r.prodMatchId ? 'Y' : 'N').padEnd(11);
  const pmid = (r.prodMatchId ?? '—').toString().padEnd(14);
  const exi = r.prodExisting
    ? `Y (id=${r.prodExisting.id}, status=${r.prodExisting.status}, basis=${r.prodExisting.moment_basis}, comp=${Number(r.prodExisting.composite).toFixed(1)})`
    : 'N';
  console.log('  ' + slug + ' ' + found + ' ' + pmid + ' ' + exi);
}

// Intended writes — by name. INSERT if no PROD row; UPDATE if a PROD row
// exists (caller's per-row call to keep PROD or replace).
console.log('\n' + '='.repeat(130));
console.log('INTENDED WRITES (Phase 2 would do this — currently NOT writing)');
console.log('='.repeat(130));
let unresolvedCount = 0;
let collisionCount  = 0;
let insertCount     = 0;
for (const r of resolved) {
  const d = r.dev;
  const action = r.prodMatchId ? (r.prodExisting ? 'UPDATE' : 'INSERT') : 'SKIP (slug unresolved on PROD)';
  if (!r.prodMatchId) unresolvedCount++;
  else if (r.prodExisting) collisionCount++;
  else insertCount++;
  console.log(
    `  ${d.match_slug}: would ${action} preview on PROD — ` +
    `status=${d.status}, moment_basis=${d.moment_basis}, composite=${Number(d.composite_score).toFixed(1)}, ` +
    `dims=[${Number(d.stakes_score).toFixed(1)}/${Number(d.quality_score).toFixed(1)}/${Number(d.narrative_score).toFixed(1)}/${Number(d.drama_score).toFixed(1)}/${Number(d.moment_score).toFixed(1)}]`
  );
}

console.log('\n' + '='.repeat(130));
console.log('FLAGS');
console.log('='.repeat(130));
if (unresolvedCount > 0) {
  console.log(`  ⚠  ${unresolvedCount} slug(s) DID NOT resolve on PROD — these will be skipped, no PROD write. Investigate before Phase 2.`);
  for (const r of resolved.filter((x) => !x.prodMatchId)) {
    console.log(`     · ${r.dev.match_slug}`);
  }
} else {
  console.log('  ✓ all 8 slugs resolved on PROD.');
}
if (collisionCount > 0) {
  console.log(`  ⚠  ${collisionCount} PROD match(es) ALREADY have a preview row — Phase 2 would UPDATE (replace) those. Per-row skip-vs-replace is the caller's call:`);
  for (const r of resolved.filter((x) => x.prodExisting)) {
    console.log(`     · ${r.dev.match_slug}: PROD article id=${r.prodExisting.id}, status=${r.prodExisting.status}, edited_at=${r.prodExisting.edited_at ? 'set (manual edit)' : 'null'}`);
  }
} else {
  console.log('  ✓ no PROD freeze collisions — clean inserts.');
}
console.log(`  Summary: ${insertCount} INSERT, ${collisionCount} UPDATE (collision), ${unresolvedCount} SKIP (unresolved).`);

console.log('\nDRY-RUN COMPLETE. NOTHING WRITTEN TO PROD. Awaiting per-row go for Phase 2.');
