// scripts/generate-watchscore.mjs — manual trigger for the Watch Score AI.
// Fetches a pre-match fixture from API-Sports, assembles + generates +
// gates, prints per-attempt prose + the server-computed composite.
//
// --save UPSERTs an articles row with type='preview', score_type='watch',
// the 5 dimension scores + notes, the 40-70 word summary, and the
// server-computed composite. Keyed on slug ('watch-<match-slug>') with
// ON CONFLICT DO UPDATE so re-running refreshes the scores.
//
// Run with: node --env-file=.env.local scripts/generate-watchscore.mjs [fixtureId] [--save]
// Default fixture id: 1503008 (USA vs Senegal, 2026-05-31 friendly).

import { generateWatchScoreForFixture } from '../lib/aiWatchScore.js';
import { sql } from '../lib/db.js';

const args = process.argv.slice(2);
const save = args.includes('--save');
const fixtureArg = args.find((a) => !a.startsWith('--'));
const fixtureId = fixtureArg ? Number(fixtureArg) : 1503008;

if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
  console.error(`Invalid fixture id: ${fixtureArg}`);
  process.exit(1);
}

console.log(`=== Generating Watch Score for fixture ${fixtureId} ===`);
const t0 = Date.now();

const result = await generateWatchScoreForFixture(fixtureId);

const m = result.envelope.match;
console.log(`\n--- match meta ---`);
console.log(`  ${m?.teams?.home} vs ${m?.teams?.away}`);
console.log(`  league:    ${m?.league} · ${m?.round ?? '—'}`);
console.log(`  kickoff:   ${m?.kickoff_at}`);
console.log(`  venue:     ${m?.venue ?? '—'}`);
console.log(`  status:    ${m?.status}`);

const DIMS = ['stakes', 'quality', 'narrative', 'drama', 'moment'];

function fmt1(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toFixed(1);
}

function printScoreBlock(parsed, composite) {
  for (const d of DIMS) {
    const dim = parsed?.[d];
    const score = dim?.score;
    const note = dim?.note;
    console.log(`  ${d.toUpperCase().padEnd(10)} ${fmt1(score).padStart(4)}   ${note ?? '(no note)'}`);
  }
  console.log(`  ${'COMPOSITE'.padEnd(10)} ${fmt1(composite).padStart(4)}   (server-computed flat mean)`);
  console.log(`  summary:   ${parsed?.summary ?? '(no summary)'}`);
}

for (const a of result.attempts) {
  console.log(`\n--- ATTEMPT ${a.attempt} MODEL OUTPUT ---`);
  if (a.error) {
    console.log(`  (model call errored: ${a.error})`);
  } else if (!a.parsed_output) {
    console.log(`  (no parseable JSON in response)`);
  } else {
    printScoreBlock(a.parsed_output, a.composite);
  }
  console.log(`--- ATTEMPT ${a.attempt} GATES ---`);
  for (const g of a.gates) {
    const tag = g.pass ? 'PASS' : 'FAIL';
    const reason = g.reason ? ` — ${g.reason}` : '';
    console.log(`  ${tag} · ${g.name}${reason}`);
  }
}

console.log(`\n--- FINAL CHOSEN WATCH SCORE (${result.validation_status}) ---`);
if (result.suppress) {
  console.log('  *** SUPPRESSED — no Watch Score generated. Render layer should HIDE the block. ***');
  console.log('  All dimensions, composite, and summary are null.');
} else {
  printScoreBlock(
    {
      stakes: result.stakes,
      quality: result.quality,
      narrative: result.narrative,
      drama: result.drama,
      moment: result.moment,
      summary: result.summary,
    },
    result.composite
  );
}

console.log(`\nvalidation_status: ${result.validation_status}`);
console.log(`model:             ${result.model}`);
console.log(`took:              ${Date.now() - t0}ms`);

if (save) {
  if (result.suppress) {
    console.log('\n--- skipping --save: Watch Score was suppressed, no payload to write ---');
    process.exit(0);
  }

  console.log('\n--- saving to articles ---');

  const matchRow = await sql`
    SELECT id, slug, league_id, home_team_id, away_team_id
    FROM matches
    WHERE external_ids->>'api_sports' = ${String(fixtureId)}
    LIMIT 1
  `;
  if (!matchRow[0]) {
    console.error(`  no matches row found for api_sports id ${fixtureId} — cannot link Watch Score`);
    process.exit(2);
  }
  const match = matchRow[0];

  const articleSlug = `watch-${match.slug}`;
  const title = `${m.teams.home} vs ${m.teams.away} — Watch Score`;
  const teamIds = [match.home_team_id, match.away_team_id].filter(Boolean);

  const inserted = await sql`
    INSERT INTO articles (
      slug, type, score_type, title,
      league_id, match_id, team_ids,
      stakes_score, quality_score, narrative_score, drama_score, moment_score,
      composite_score,
      stakes_note, quality_note, narrative_note, drama_note, moment_note,
      watch_summary,
      author, status
    ) VALUES (
      ${articleSlug}, 'preview', 'watch', ${title},
      ${match.league_id}, ${match.id}, ${teamIds},
      ${result.stakes.score}, ${result.quality.score}, ${result.narrative.score}, ${result.drama.score}, ${result.moment.score},
      ${result.composite},
      ${result.stakes.note}, ${result.quality.note}, ${result.narrative.note}, ${result.drama.note}, ${result.moment.note},
      ${result.summary},
      'auto', 'draft'
    )
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title,
      league_id = EXCLUDED.league_id,
      match_id = EXCLUDED.match_id,
      team_ids = EXCLUDED.team_ids,
      stakes_score = EXCLUDED.stakes_score,
      quality_score = EXCLUDED.quality_score,
      narrative_score = EXCLUDED.narrative_score,
      drama_score = EXCLUDED.drama_score,
      moment_score = EXCLUDED.moment_score,
      composite_score = EXCLUDED.composite_score,
      stakes_note = EXCLUDED.stakes_note,
      quality_note = EXCLUDED.quality_note,
      narrative_note = EXCLUDED.narrative_note,
      drama_note = EXCLUDED.drama_note,
      moment_note = EXCLUDED.moment_note,
      watch_summary = EXCLUDED.watch_summary,
      updated_at = now()
    RETURNING id, slug
  `;

  const row = inserted[0];
  console.log(`  upserted articles row id=${row.id} slug=${row.slug}`);
  console.log(`  match_id=${match.id}  league_id=${match.league_id}  team_ids=${JSON.stringify(teamIds)}`);
  console.log(`  composite (server-computed) = ${fmt1(result.composite)}`);
  console.log(`  NOTE: raw_response is NOT persisted — articles has no JSONB column for it.`);
}
