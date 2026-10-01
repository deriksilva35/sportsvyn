// scripts/nba-league-import.mjs - the NBA league row, its thirty current
// teams, and their colours. DRY RUN BY DEFAULT. Reused: every re-seed, every
// relocation or rename, and the top of every season.
//
//   set -a && . ./.env.local && set +a
//   node scripts/nba-league-import.mjs                    # DRY RUN, dev target
//   node scripts/nba-league-import.mjs --apply            # WRITE, dev target
//   node scripts/nba-league-import.mjs --prod             # DRY RUN, prod target
//   node scripts/nba-league-import.mjs --prod --apply     # WRITE, prod
//
// THE CREDENTIAL COMES FROM THE ENVIRONMENT: neon(process.env.PROD_DATABASE_URL)
// or DATABASE_URL. Nothing here prints a secret; the target is named by host
// and a short fingerprint.

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { fetchNbaTeams, shapeNbaTeams, nbaLeagueRow, upsertNbaLeague, upsertNbaTeams, NBA_LEAGUE_SLUG } from '../lib/nba/sync.js';
import { nbaColorRows, syncNbaColors, NBA_COLORS } from '../lib/nba/teamColors.js';

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

const feed = await fetchNbaTeams();
const { teams, rejected, historical } = shapeNbaTeams(feed);
const colors = new Map(nbaColorRows().map((c) => [c.abbreviation, c]));

console.log(`\nLEAGUE ROW: ${JSON.stringify(nbaLeagueRow())}`);
const existing = (await sql`SELECT id, slug, sport FROM leagues WHERE slug = ${NBA_LEAGUE_SLUG}`)[0] ?? null;
console.log(existing ? `  already present: id=${existing.id} sport=${existing.sport}` : '  not present - would be inserted');

console.log(`\nCURRENT TEAMS (${teams.length} shaped, ${rejected.length} refused, ${historical} historical skipped of ${feed.length})`);
console.log('  slug                        abbr  primary   secondary  conf/division        name');
let noColour = 0;
for (const t of teams.sort((a, b) => a.slug.localeCompare(b.slug))) {
  const c = colors.get(t.abbreviation);
  if (!c) noColour += 1;
  console.log(`  ${t.slug.padEnd(27)} ${t.abbreviation.padEnd(5)} ${(c?.primary ?? 'NONE').padEnd(9)} ${(c?.secondary ?? 'NONE').padEnd(10)} ${`${t.conference}/${t.division}`.padEnd(20)} ${t.name}`);
}
if (rejected.length) { console.log('\n  REFUSED (missing a join key):'); for (const r of rejected) console.log('   ', JSON.stringify(r)); }

const feedAbbrs = new Set(teams.map((t) => t.abbreviation));
const tableAbbrs = new Set(Object.keys(NBA_COLORS));
const missing = [...feedAbbrs].filter((a) => !tableAbbrs.has(a)).sort();
const orphan = [...tableAbbrs].filter((a) => !feedAbbrs.has(a)).sort();
console.log(`\nCOLOUR COVERAGE  teams ${teams.length} | coloured ${teams.length - noColour} | in feed with no colour: ${missing.join(', ') || '(none)'} | colour with no team: ${orphan.join(', ') || '(none)'}`);

if (teams.length !== 30) {
  console.error(`\nREFUSE: expected 30 current teams, the feed gave ${teams.length}. Read the feed before writing.`);
  process.exit(1);
}
if (!APPLY) { console.log('\nDRY RUN ONLY. Re-run with --apply to write.\n'); process.exit(0); }
if (missing.length || orphan.length || rejected.length) {
  console.error('\nREFUSE TO APPLY: the feed and the colour table disagree, or a row was refused. Fix the table first.');
  process.exit(1);
}

const leagueId = await upsertNbaLeague(sql);
const t = await upsertNbaTeams(sql, leagueId, feed);
const c = await syncNbaColors(sql, leagueId);
console.log(`\nAPPLIED  league id=${leagueId} | teams written ${t.written}/${t.shaped} | colours updated ${c.updated} of ${c.teams}`);
if (c.missingColour.length) console.log(`  teams still without a colour: ${c.missingColour.join(', ')}`);
if (c.unmatchedRow.length) console.log(`  colour rows matching no team: ${c.unmatchedRow.join(', ')}`);
