// scripts/sync-form.mjs — manual trigger for the reusable form sync.
//
// Three forms:
//   node --env-file=.env.local scripts/sync-form.mjs --match 1503008
//     → resolves both teams of that fixture via API-Sports and syncs each
//
//   node --env-file=.env.local scripts/sync-form.mjs --team 2384 [--team 13]
//     → syncs one or more api_sports team ids directly
//
//   node --env-file=.env.local scripts/sync-form.mjs 2384 13
//     → bare numeric args are also treated as api_sports team ids
//
// DEV (default DATABASE_URL); the cron-callable variant will pass prod via
// the same DATABASE_URL override pattern other scripts use.

import { syncTeamRecentResults } from '../lib/formSync.js';
import { apiSports } from '../lib/apiSports.js';

const args = process.argv.slice(2);
const matchIdx = args.indexOf('--match');
const matchFixtureId = matchIdx >= 0 ? Number(args[matchIdx + 1]) : null;

let teamIds = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--team' && args[i + 1]) {
    teamIds.push(Number(args[i + 1]));
    i++;
  } else if (args[i] === '--match') {
    i++; // already consumed
  } else if (!args[i].startsWith('--')) {
    const n = Number(args[i]);
    if (Number.isInteger(n) && n > 0) teamIds.push(n);
  }
}

if (matchFixtureId) {
  console.log(`=== Resolving teams for fixture ${matchFixtureId} ===`);
  const fixtures = await apiSports.fixture(matchFixtureId);
  const f = fixtures[0];
  if (!f) {
    console.error(`No fixture for id ${matchFixtureId}`);
    process.exit(1);
  }
  teamIds = [f.teams.home.id, f.teams.away.id];
  console.log(`  home: ${f.teams.home.name} (api_sports id ${teamIds[0]})`);
  console.log(`  away: ${f.teams.away.name} (api_sports id ${teamIds[1]})`);
}

if (teamIds.length === 0) {
  console.error('No team ids supplied. Use --match <fixture-id> or pass team ids.');
  process.exit(1);
}

const t0 = Date.now();
const summaries = [];
for (const id of teamIds) {
  console.log(`\n=== syncTeamRecentResults(${id}) ===`);
  const r = await syncTeamRecentResults(id, { limit: 10 });
  summaries.push(r);
  console.log(`  fixtures_seen:     ${r.fixtures_seen}`);
  console.log(`  skipped_non_final: ${r.skipped_non_final}`);
  console.log(`  matches_upserted:  ${r.matches_upserted}`);
  console.log(`  leagues_created:   ${r.leagues_created}`);
  console.log(`  leagues_reused:    ${r.leagues_reused}`);
  console.log(`  teams_touched:     ${r.teams_touched}`);
  console.log(`  detail:`);
  for (const d of r.detail) {
    console.log(`    [${d.fixture_id}] ${d.date?.slice(0, 10)} ${d.league.padEnd(28)} ${d.score}`);
  }
}

console.log(`\ntotal time: ${Date.now() - t0}ms`);
