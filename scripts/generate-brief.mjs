// scripts/generate-brief.mjs — manual trigger for Tier 1 Brief generation.
// Fetches a finished fixture from API-Sports, assembles + generates +
// gates, then prints the result. Pass --save to also INSERT into
// match_briefs (requires the fixture to exist in our matches table).
//
// Per-attempt model output is printed BEFORE each attempt's gate trace
// so the prose can be judged on voice quality even when gating rejects it.
//
// Run with: node --env-file=.env.local scripts/generate-brief.mjs [fixtureId] [--save]
// Default fixture id: 1501815 (Brazil 1-2 France, March friendly).

import { generateBriefForFixture } from '../lib/aiBrief.js';
import { sql } from '../lib/db.js';

const args = process.argv.slice(2);
const save = args.includes('--save');
const fixtureArg = args.find((a) => !a.startsWith('--'));
const fixtureId = fixtureArg ? Number(fixtureArg) : 1501815;

if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
  console.error(`Invalid fixture id: ${fixtureArg}`);
  process.exit(1);
}

console.log(`=== Generating Tier 1 Brief for fixture ${fixtureId} ===`);
const t0 = Date.now();

const result = await generateBriefForFixture(fixtureId);

const m = result.envelope.match;
console.log(`\n--- match meta ---`);
console.log(`  ${m?.teams?.home} ${m?.score?.home ?? '–'}-${m?.score?.away ?? '–'} ${m?.teams?.away}`);
console.log(`  league:    ${m?.league} · ${m?.round ?? '—'}`);
console.log(`  kickoff:   ${m?.kickoff_at}`);
console.log(`  venue:     ${m?.venue ?? '—'}`);
console.log(`  status:    ${m?.status}`);
console.log(`  events:    ${result.envelope.events?.length ?? 0}`);
console.log(`  lineups:   ${result.envelope.lineups?.length ?? 0} sides`);
console.log(`  stat keys: ${result.envelope.statistics ? Object.keys(result.envelope.statistics).join(', ') : '(none)'}`);

for (const a of result.attempts) {
  console.log(`\n--- ATTEMPT ${a.attempt} MODEL OUTPUT ---`);
  if (a.error) {
    console.log(`  (model call errored: ${a.error})`);
  } else if (!a.parsed_output) {
    console.log(`  (no parseable JSON in response)`);
  } else {
    console.log(`  headline:    ${a.parsed_output.headline}`);
    console.log(`  paragraph_1: ${a.parsed_output.paragraph_1}`);
    console.log(`  paragraph_2: ${a.parsed_output.paragraph_2}`);
    console.log(`  paragraph_3: ${a.parsed_output.paragraph_3 ?? '(null)'}`);
  }
  console.log(`--- ATTEMPT ${a.attempt} GATES ---`);
  for (const g of a.gates) {
    const tag = g.pass ? 'PASS' : 'FAIL';
    const reason = g.reason ? ` — ${g.reason}` : '';
    console.log(`  ${tag} · ${g.name}${reason}`);
  }
}

console.log(`\n--- FINAL CHOSEN BRIEF (${result.validation_status}) ---`);
console.log(`headline:`);
console.log(`  ${result.headline}`);
console.log(`paragraph_1:`);
console.log(`  ${result.paragraph_1}`);
console.log(`paragraph_2:`);
console.log(`  ${result.paragraph_2}`);
console.log(`paragraph_3:`);
console.log(`  ${result.paragraph_3 ?? '(null)'}`);

console.log(`\nvalidation_status: ${result.validation_status}`);
console.log(`model:             ${result.model}`);
console.log(`took:              ${Date.now() - t0}ms`);

if (save) {
  console.log(`\n--- saving to match_briefs ---`);
  const externalId = String(fixtureId);
  const matchRow = await sql`
    SELECT id FROM matches WHERE external_ids->>'api_sports' = ${externalId} LIMIT 1
  `;
  if (!matchRow[0]) {
    console.error(`  no matches row found for api_sports id ${fixtureId} — not saving`);
    process.exit(2);
  }
  const inserted = await sql`
    INSERT INTO match_briefs (
      match_id, kind, headline, paragraph_1, paragraph_2, paragraph_3,
      model, raw_response, validation_status
    ) VALUES (
      ${matchRow[0].id}, 'auto',
      ${result.headline}, ${result.paragraph_1}, ${result.paragraph_2}, ${result.paragraph_3},
      ${result.model},
      ${result.raw_response ? JSON.stringify(result.raw_response) : null}::jsonb,
      ${result.validation_status}
    )
    RETURNING id
  `;
  console.log(`  inserted match_briefs.id = ${inserted[0].id}`);
}
