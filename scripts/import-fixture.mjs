// scripts/import-fixture.mjs
// Throwaway-style importer that wraps lib/syncFixture.js.
// Run via: node --env-file=.env.local scripts/import-fixture.mjs [fixtureId]
// Defaults to fixture id 1503008 (USA vs Senegal, 2026-05-31 friendly).

import { syncFixture } from '../lib/syncFixture.js';

const idArg = process.argv[2];
const fixtureId = idArg ? Number(idArg) : 1503008;

if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
  console.error(`Invalid fixture id: ${idArg}`);
  process.exit(1);
}

(async () => {
  console.log(`=== Importing API-Sports fixture ${fixtureId} ===`);
  const result = await syncFixture(fixtureId);
  console.log('match row:');
  console.log(`  id:           ${result.match_id}`);
  console.log(`  slug:         ${result.slug}`);
  console.log(`  status:       ${result.status}`);
  console.log(`  score:        ${result.home_score ?? '—'} — ${result.away_score ?? '—'}`);
  console.log(`  kickoff_at:   ${new Date(result.kickoff_at).toISOString()}`);
  console.log(`  minute:       ${result.minute ?? '—'}`);
  console.log(`  venue:        ${result.venue ?? '—'}`);
  console.log(`  league_id:    ${result.league_id} (international-friendlies)`);
  console.log(`  home:         id=${result.home_team.id} "${result.home_team.name}" slug=${result.home_team.slug}`);
  console.log(`  away:         id=${result.away_team.id} "${result.away_team.name}" slug=${result.away_team.slug}`);
  console.log(`\nopen at: /match/${result.slug}`);
})();
