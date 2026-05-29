// scripts/generate-preview.mjs — manual trigger for the editorial Preview AI.
// Fetches a fixture from API-Sports, runs the readiness gate (thin vs rich
// based on data presence), generates the thin preview if eligible, prints
// readiness + each attempt's prose + gate trace + the final chosen output.
//
// --save UPSERTs an articles row keyed on slug='preview-<match-slug>' with
//   type='preview', score_type=NULL                  ← distinct from watch row
//   title=headline, subtitle=subtitle, body=paragraphs joined by \n\n
//   match_id, league_id, team_ids=[home,away]
//   author='auto', status='draft'
// Suppressed runs skip the write (a null-body article row would be
// pointless — the page already falls back to the empty placeholder).
//
// Run with: node --env-file=.env.local scripts/generate-preview.mjs [fixtureId] [--save]
// Default fixture id: 1503008 (USA vs Senegal, 2026-05-31 friendly).

import { generatePreviewForFixture } from '../lib/aiPreview.js';
import { sql } from '../lib/db.js';

const args = process.argv.slice(2);
const save = args.includes('--save');
const fixtureArg = args.find((a) => !a.startsWith('--'));
const fixtureId = fixtureArg ? Number(fixtureArg) : 1503008;

if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
  console.error(`Invalid fixture id: ${fixtureArg}`);
  process.exit(1);
}

console.log(`=== Generating Preview for fixture ${fixtureId} ===`);
const t0 = Date.now();

const result = await generatePreviewForFixture(fixtureId);

const m = result.envelope.match;
console.log(`\n--- fixture meta ---`);
console.log(`  ${m?.home} vs ${m?.away}`);
console.log(`  league:    ${m?.league} · ${m?.round ?? '—'}`);
console.log(`  kickoff:   ${m?.kickoff_at}`);
console.log(`  venue:     ${m?.venue ?? '—'}`);
console.log(`  status:    ${m?.status}`);

console.log(`\n--- readiness ---`);
console.log(`  phase:     ${result.phase}`);
console.log(`  present:`);
for (const [k, v] of Object.entries(result.present)) {
  console.log(`    ${k.padEnd(14)} ${v ? 'YES' : 'no '}`);
}

function printPreviewBlock(parsed) {
  console.log(`  headline:`);
  console.log(`    ${parsed.headline ?? '(none)'}`);
  console.log(`  subtitle:`);
  console.log(`    ${parsed.subtitle ?? '(null)'}`);
  console.log(`  body:`);
  const body = parsed.body ?? '';
  if (!body) {
    console.log('    (none)');
  } else {
    for (const para of body.split(/\n\n+/)) {
      console.log(`    ${para}`);
      console.log('');
    }
  }
}

for (const a of result.attempts) {
  console.log(`\n--- ATTEMPT ${a.attempt} MODEL OUTPUT ---`);
  if (a.error) {
    console.log(`  (model call errored: ${a.error})`);
  } else if (!a.parsed_output) {
    console.log(`  (no parseable JSON in response)`);
  } else {
    printPreviewBlock(a.parsed_output);
  }
  console.log(`--- ATTEMPT ${a.attempt} GATES ---`);
  for (const g of a.gates) {
    const tag = g.pass ? 'PASS' : 'FAIL';
    const reason = g.reason ? ` — ${g.reason}` : '';
    console.log(`  ${tag} · ${g.name}${reason}`);
  }
}

console.log(`\n--- FINAL CHOSEN PREVIEW (${result.validation_status}) ---`);
if (result.validation_status === 'suppressed') {
  console.log('  *** SUPPRESSED — no preview prose. The PreviewLeft slot renders its placeholder. ***');
} else {
  printPreviewBlock({
    headline: result.headline,
    subtitle: result.subtitle,
    body: result.body,
  });
}

console.log(`\nvalidation_status: ${result.validation_status}`);
console.log(`model:             ${result.model}`);
console.log(`took:              ${Date.now() - t0}ms`);

if (save) {
  if (result.validation_status === 'suppressed') {
    console.log('\n--- skipping --save: preview was suppressed, no body to write ---');
    process.exit(0);
  }

  console.log('\n--- saving editorial preview to articles (score_type IS NULL) ---');

  const matchRow = await sql`
    SELECT id, slug, league_id, home_team_id, away_team_id
    FROM matches
    WHERE external_ids->>'api_sports' = ${String(fixtureId)}
    LIMIT 1
  `;
  if (!matchRow[0]) {
    console.error(`  no matches row for api_sports id ${fixtureId} — cannot link preview`);
    process.exit(2);
  }
  const match = matchRow[0];

  const articleSlug = `preview-${match.slug}`;
  const teamIds = [match.home_team_id, match.away_team_id].filter(Boolean);

  const inserted = await sql`
    INSERT INTO articles (
      slug, type, score_type, title, subtitle,
      league_id, match_id, team_ids,
      body,
      author, status
    ) VALUES (
      ${articleSlug}, 'preview', NULL,
      ${result.headline}, ${result.subtitle},
      ${match.league_id}, ${match.id}, ${teamIds},
      ${result.body},
      'auto', 'draft'
    )
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      subtitle = EXCLUDED.subtitle,
      league_id = EXCLUDED.league_id,
      match_id = EXCLUDED.match_id,
      team_ids = EXCLUDED.team_ids,
      body = EXCLUDED.body,
      updated_at = now()
    RETURNING id, slug, length(body) AS body_len
  `;
  const row = inserted[0];
  console.log(`  upserted articles row id=${row.id} slug=${row.slug} body_len=${row.body_len}`);
  console.log(`  match_id=${match.id}  league_id=${match.league_id}  team_ids=${JSON.stringify(teamIds)}`);
}
