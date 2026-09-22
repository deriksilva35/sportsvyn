// scripts/mlb-league-import.mjs — the MLB league row, its thirty clubs, and
// their colours. DRY RUN BY DEFAULT.
//
// WHY THIS IS A SCRIPT AND NOT A ONE-OFF. It runs again: every re-seed, every
// time a club is renamed or relocated, and at the top of a future season. The
// test is reuse, and this is reused.
//
//   set -a && . ./.env.local && set +a
//   node scripts/mlb-league-import.mjs                    # DRY RUN, dev target
//   node scripts/mlb-league-import.mjs --prod             # DRY RUN, prod target
//   node scripts/mlb-league-import.mjs --prod --apply     # WRITE
//
// THE CREDENTIAL COMES FROM THE ENVIRONMENT, never a default argument and
// never an inline string: neon(process.env.PROD_DATABASE_URL). Nothing here
// prints a secret; the target is named by host and by a short fingerprint, the
// convention scripts/apply-migrations.mjs established.

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { fetchMlbTeams, shapeMlbTeams, mlbLeagueRow, upsertMlbLeague, upsertMlbTeams, MLB_LEAGUE_SLUG } from '../lib/mlb/sync.js';
import { mlbColorRows, syncMlbColors, MLB_COLORS } from '../lib/mlb/teamColors.js';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');

const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) { console.error(`REFUSE: ${PROD ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} missing in env`); process.exit(1); }
const sql = neon(url);
const fp = crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 12);

console.log('='.repeat(78));
console.log(`TARGET        ${new URL(url).host}`);
console.log(`FINGERPRINT   ${fp}`);
console.log(`MODE          ${APPLY ? 'APPLY (writes)' : 'DRY RUN (writes nothing)'}`);
console.log('='.repeat(78));

const feed = await fetchMlbTeams();
const { teams, rejected } = shapeMlbTeams(feed);
const colors = new Map(mlbColorRows().map((c) => [c.abbreviation, c]));

console.log(`\nLEAGUE ROW: ${JSON.stringify(mlbLeagueRow())}`);
const existing = (await sql`SELECT id, slug, sport FROM leagues WHERE slug = ${MLB_LEAGUE_SLUG}`)[0] ?? null;
console.log(existing ? `  already present: id=${existing.id} sport=${existing.sport}` : '  not present - would be inserted');

console.log(`\nTHIRTY CLUBS (${teams.length} shaped, ${rejected.length} refused)`);
console.log('  slug                        abbr  primary   secondary  conference/division  name');
let noColour = 0;
for (const t of teams.sort((a, b) => a.slug.localeCompare(b.slug))) {
  const c = colors.get(t.abbreviation);
  if (!c) noColour += 1;
  console.log(`  ${t.slug.padEnd(27)} ${t.abbreviation.padEnd(5)} ${(c?.primary ?? 'NONE').padEnd(9)} ${(c?.secondary ?? 'NONE').padEnd(10)} ${`${t.conference}/${t.division}`.padEnd(20)} ${t.name}`);
}
if (rejected.length) { console.log('\n  REFUSED (missing a join key):'); for (const r of rejected) console.log('   ', JSON.stringify(r)); }

// WHAT THE TABLE AND THE FEED DISAGREE ABOUT, both directions, before writing.
const feedAbbrs = new Set(teams.map((t) => t.abbreviation));
const tableAbbrs = new Set(Object.keys(MLB_COLORS));
const missing = [...feedAbbrs].filter((a) => !tableAbbrs.has(a)).sort();
const orphan = [...tableAbbrs].filter((a) => !feedAbbrs.has(a)).sort();
console.log(`\nCOLOUR COVERAGE  clubs ${teams.length} | coloured ${teams.length - noColour} | in feed with no colour: ${missing.join(', ') || '(none)'} | colour with no club: ${orphan.join(', ') || '(none)'}`);

if (!APPLY) { console.log('\nDRY RUN ONLY. Re-run with --apply to write.\n'); process.exit(0); }
if (missing.length || orphan.length || rejected.length) {
  console.error('\nREFUSE TO APPLY: the feed and the colour table disagree, or a row was refused. Fix the table first.');
  process.exit(1);
}

const leagueId = await upsertMlbLeague(sql);
const t = await upsertMlbTeams(sql, leagueId, feed);
const c = await syncMlbColors(sql, leagueId);
console.log(`\nAPPLIED  league id=${leagueId} | teams written ${t.written}/${t.shaped} | colours updated ${c.updated} of ${c.teams}`);
if (c.missingColour.length) console.log(`  clubs still without a colour: ${c.missingColour.join(', ')}`);
if (c.unmatchedRow.length) console.log(`  colour rows matching no club: ${c.unmatchedRow.join(', ')}`);
