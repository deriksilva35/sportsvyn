// scripts/migrate-md1-prematch-to-prod-write.mjs
//
// PROD content-load PHASE 2 — WRITES the 8 reviewed DEV MD1 preview
// rows to PROD by natural key (match slug). Mirror of the dry-run
// script with the same discipline, plus per-row INSERT.
//
//   · Identity = match slug, re-resolved on the PROD branch AT WRITE
//     TIME (don't trust dry-run ids).
//   · Pre-write freeze re-check: refuse to overwrite if a PROD preview
//     row appeared since the dry-run.
//   · PROD credentials from PROD_DATABASE_URL env. Never inlined.
//   · Per-row writes (no transactional batch) — log each by name so a
//     partial failure is recoverable from the report.
//
// Run:
//   PROD_DATABASE_URL="postgresql://..." node scripts/migrate-md1-prematch-to-prod-write.mjs

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
if (devHost.includes('winter-dawn'))   throw new Error('REFUSE: DATABASE_URL points at PROD (winter-dawn).');
if (!prodHost.includes('winter-dawn')) throw new Error('REFUSE: PROD_DATABASE_URL does not look like PROD (winter-dawn).');
console.log('dev  host:', devHost);
console.log('prod host:', prodHost);

const dev  = neon(DEV_URL);
const prod = neon(PROD_URL);

// Pull the 8 reviewed DEV rows + DEV match slug. Full payload.
const devRows = await dev`
  SELECT
    a.slug         AS article_slug,
    a.title, a.subtitle, a.body, a.watch_summary,
    a.stakes_score, a.quality_score, a.narrative_score, a.drama_score, a.moment_score,
    a.composite_score,
    a.stakes_note, a.quality_note, a.narrative_note, a.drama_note, a.moment_note,
    a.moment_basis, a.status, a.published_at, a.edited_at, a.author,
    m.slug         AS match_slug
  FROM articles a
  JOIN matches m ON m.id = a.match_id
  JOIN leagues l ON l.id = m.league_id
  WHERE a.type='preview' AND a.score_type='watch'
    AND l.slug = 'fifa-wc-2026'
    AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date BETWEEN '2026-06-11'::date AND '2026-06-13'::date
  ORDER BY m.kickoff_at ASC
`;
console.log(`\nDEV: ${devRows.length} reviewed MD1 preview rows to migrate.\n`);
if (devRows.length === 0) { console.log('Nothing to do.'); process.exit(0); }

// Resolve PROD league_id once.
const lg = await prod`SELECT id FROM leagues WHERE slug = 'fifa-wc-2026' LIMIT 1`;
if (lg.length === 0) throw new Error('PROD: league fifa-wc-2026 not found — bailing.');
const prodLeagueId = lg[0].id;
console.log(`PROD: fifa-wc-2026 league_id = ${prodLeagueId}\n`);

const results = [];
for (const d of devRows) {
  const tag = d.match_slug;
  try {
    // 1. Re-resolve PROD match_id BY SLUG, on PROD, AT WRITE TIME.
    const pm = await prod`
      SELECT m.id
        FROM matches m
        JOIN leagues l ON l.id = m.league_id
       WHERE m.slug = ${d.match_slug}
         AND l.slug = 'fifa-wc-2026'
       LIMIT 1
    `;
    if (pm.length === 0) {
      console.log(`  SKIP  ${tag} — slug did not resolve on PROD (unexpected vs dry-run)`);
      results.push({ slug: tag, outcome: 'skip_unresolved' });
      continue;
    }
    const prodMatchId = pm[0].id;

    // 2. Pre-write freeze re-check.
    const existing = await prod`
      SELECT id, status FROM articles
       WHERE match_id = ${prodMatchId}
         AND type = 'preview' AND score_type = 'watch'
       LIMIT 1
    `;
    if (existing.length > 0) {
      console.log(`  SKIP  ${tag} — PROD preview row appeared since dry-run (id=${existing[0].id}, status=${existing[0].status}). Not overwriting.`);
      results.push({ slug: tag, outcome: 'skip_collision', existing_id: existing[0].id });
      continue;
    }

    // 3. INSERT — full reviewed payload, status + published_at carried from DEV.
    const ins = await prod`
      INSERT INTO articles (
        slug, type, score_type, title, subtitle, body,
        stakes_score, quality_score, narrative_score, drama_score, moment_score,
        composite_score,
        stakes_note, quality_note, narrative_note, drama_note, moment_note,
        watch_summary, moment_basis,
        league_id, match_id, team_ids,
        status, published_at, edited_at, author
      ) VALUES (
        ${d.article_slug}, 'preview', 'watch',
        ${d.title}, ${d.subtitle}, ${d.body},
        ${d.stakes_score}, ${d.quality_score}, ${d.narrative_score}, ${d.drama_score}, ${d.moment_score},
        ${d.composite_score},
        ${d.stakes_note}, ${d.quality_note}, ${d.narrative_note}, ${d.drama_note}, ${d.moment_note},
        ${d.watch_summary}, ${d.moment_basis},
        ${prodLeagueId}, ${prodMatchId}, ${'{}'}::int[],
        ${d.status}, ${d.published_at}, ${d.edited_at}, ${d.author ?? 'auto'}
      )
      RETURNING id, status, moment_basis
    `;
    const newId = ins[0].id;
    console.log(`  INSERTED ${tag} → PROD article id ${newId}  (status=${ins[0].status}, basis=${ins[0].moment_basis})`);
    results.push({ slug: tag, outcome: 'inserted', prod_article_id: newId });
  } catch (err) {
    console.log(`  ERROR  ${tag} — ${err?.message ?? err}`);
    results.push({ slug: tag, outcome: 'error', error: String(err?.message ?? err) });
  }
}

// Tally.
const inserted = results.filter((r) => r.outcome === 'inserted');
const skipped  = results.filter((r) => r.outcome.startsWith('skip_'));
const errors   = results.filter((r) => r.outcome === 'error');
console.log('\n' + '='.repeat(100));
console.log('PHASE 2 SUMMARY');
console.log('='.repeat(100));
console.log(`  inserted: ${inserted.length}`);
console.log(`  skipped:  ${skipped.length}`);
console.log(`  errored:  ${errors.length}`);

// Verify-after-write: count + list PROD preview rows in the window.
console.log('\n' + '='.repeat(100));
console.log('VERIFY: PROD preview rows for fifa-wc-2026 / Jun 11–13 PT');
console.log('='.repeat(100));
const verifyRows = await prod`
  SELECT a.id, m.slug AS match_slug, a.status, a.moment_basis,
         a.composite_score::float AS composite,
         a.published_at
    FROM articles a
    JOIN matches m ON m.id = a.match_id
    JOIN leagues l ON l.id = m.league_id
   WHERE a.type='preview' AND a.score_type='watch'
     AND l.slug = 'fifa-wc-2026'
     AND (m.kickoff_at AT TIME ZONE 'America/Los_Angeles')::date BETWEEN '2026-06-11'::date AND '2026-06-13'::date
   ORDER BY m.kickoff_at ASC
`;
console.log(`  count on PROD: ${verifyRows.length}`);
console.log('  id    match                                       status      moment_basis  composite');
console.log('  ' + '─'.repeat(96));
for (const v of verifyRows) {
  const slug = v.match_slug.padEnd(42);
  const status = v.status.padEnd(11);
  const mb = (v.moment_basis ?? '?').padEnd(13);
  console.log(`  ${String(v.id).padStart(4)}  ${slug} ${status} ${mb} ${Number(v.composite).toFixed(1)}`);
}
console.log('\nDONE.');
