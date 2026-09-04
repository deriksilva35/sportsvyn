#!/usr/bin/env node
// scripts/team-key-abbreviate.mjs — resolve nfl_player_season_totals.team_key
// from a raw team NAME string to teams.abbreviation, for footballdb rows.
//
// BDL rows never need this: scripts/bdl-season-totals-backfill.mjs computes
// team_key straight from teams.abbreviation via the real team_id FK on
// nfl_player_game_stats, so it always resolves, never a string match.
//
// FOOTBALLDB ROWS ONLY HAVE A RAW STRING ("Green Bay Packers", "Houston
// Oilers") - there is no existing join to teams for these (grepped
// lib/footballdb/identity.js: team is explicitly "never the join key
// itself"; there is no nfl_teams table, no lineage table). This script
// builds the only join that CAN exist: an exact, case-insensitive match of
// the raw team_key string against teams.name. A CURRENT franchise whose name
// never changed (Green Bay Packers, Dallas Cowboys, ...) matches and gets
// its abbreviation. A row naming a HISTORICAL identity a current teams row
// does not carry (Houston Oilers, St. Louis/Phoenix Cardinals, Baltimore
// Colts, San Diego/LA-era Chargers, Oakland/LA-era Raiders, Washington
// Redskins, St. Louis-era Rams) does NOT match - and is left exactly as it
// is, unresolved, reported below. Per ruling: report the misses, never
// invent a lineage table to paper over them.
//
// Usage:
//   set -a && . ./.env.local && set +a
//   node scripts/team-key-abbreviate.mjs             # dry run, reports only
//   node scripts/team-key-abbreviate.mjs --apply       # writes

import crypto from 'node:crypto';
import { sql } from '../lib/db.js';

const apply = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const fingerprint = crypto.createHash('sha256').update(String(process.env.DATABASE_URL)).digest('hex').slice(0, 12);
console.log('='.repeat(74));
console.log(`TARGET   DATABASE_URL -> ${new URL(process.env.DATABASE_URL).host}`);
console.log(`FINGERPRINT   ${fingerprint}`);
console.log(`WRITES   ${apply ? 'YES — --apply given' : 'NO — dry run'}`);
console.log('='.repeat(74));

const teams = await sql`SELECT t.name, t.abbreviation FROM teams t JOIN leagues l ON l.id = t.league_id WHERE l.slug = 'nfl'`;
const byName = new Map(teams.map((t) => [t.name.toLowerCase(), t.abbreviation]));

const rows = await sql`
  SELECT id, team_key FROM nfl_player_season_totals
  WHERE source = 'footballdb' AND team_key !~ '^[A-Z]{2,3}$'`;

const resolved = [];
const missedByKey = new Map();
for (const r of rows) {
  const abbr = byName.get(r.team_key.toLowerCase());
  if (abbr) resolved.push({ id: r.id, team_key: r.team_key, abbr });
  else missedByKey.set(r.team_key, (missedByKey.get(r.team_key) ?? 0) + 1);
}

console.log(`\nfootballdb rows examined: ${rows.length}`);
console.log(`resolves to an abbreviation: ${resolved.length}`);
console.log(`unresolved (left as-is): ${rows.length - resolved.length}`);
console.log('\nUNRESOLVED team_key strings (no current franchise matches):');
for (const [k, n] of [...missedByKey.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`   "${k}" — ${n} rows`);
}

if (apply && resolved.length) {
  for (const r of resolved) {
    await sql`UPDATE nfl_player_season_totals SET team_key = ${r.abbr} WHERE id = ${r.id}`;
  }
  console.log(`\nWROTE ${resolved.length} team_key updates.`);
} else {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to write.');
}
