// scripts/mlb-schedule-import.mjs — MLB games into matches, a day at a time.
// DRY RUN BY DEFAULT.
//
//   set -a && . ./.env.local && set +a
//   node scripts/mlb-schedule-import.mjs --prod 2026-09-22 2026-09-23
//   node scripts/mlb-schedule-import.mjs --prod --apply 2026-09-22
//   node scripts/mlb-schedule-import.mjs --prod --apply --postseason 2026
//
// It runs again on every day of the season and once more when the postseason
// bracket is set, so it lives here rather than in a scratchpad.

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { fetchMlbDay, fetchMlbPostseason, slugsFor, shapeMlbMatch, writeMlbMatches } from '../lib/mlb/schedule.js';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');
const POST = args.includes('--postseason');
const rest = args.filter((a) => !a.startsWith('--'));

const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) { console.error('REFUSE: database url missing in env'); process.exit(1); }
const sql = neon(url);
console.log(`TARGET ${new URL(url).host} | FP ${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)} | ${APPLY ? 'APPLY' : 'DRY RUN'}`);

const [league] = await sql`SELECT id FROM leagues WHERE slug = 'mlb' LIMIT 1`;
if (!league) { console.error('REFUSE: no mlb league row - run mlb-league-import first'); process.exit(1); }
const teams = await sql`
  SELECT id, external_ids->>'bdl_team_id' AS pid FROM teams
   WHERE league_id = ${league.id} AND jsonb_exists(external_ids, 'bdl_team_id')`;
const teamIdByBdl = new Map(teams.map((t) => [t.pid, t.id]));

let all = [];
if (POST) {
  for (const season of rest) all.push(...await fetchMlbPostseason(season));
  console.log(`postseason ${rest.join(', ')}: ${all.length} games`);
} else {
  for (const day of rest) {
    const rows = await fetchMlbDay(day);
    console.log(`${day}: ${rows.length} games`);
    all.push(...rows);
  }
}

const slugs = slugsFor(all);
const unmapped = {};
let ok = 0; const refused = [];
for (const r of all) {
  const g = shapeMlbMatch(r, slugs.get(String(r.id)) ?? null, teamIdByBdl, unmapped);
  if (!g) { refused.push(r.id); continue; }
  ok += 1;
  console.log(`  ${g.slug.padEnd(30)} ${String(g.status).padEnd(10)} ${g.seasonPhase} ${String(g.kickoffAt).slice(0, 16)} ${g.venue ?? ''}`);
}
console.log(`\nshaped ${ok} | refused ${refused.length}${refused.length ? ` (${refused.join(', ')})` : ''} | unmapped statuses ${JSON.stringify(unmapped)}`);

if (!APPLY) { console.log('\nDRY RUN ONLY.\n'); process.exit(0); }
if (refused.length) { console.error('REFUSE TO APPLY: a game could not be shaped.'); process.exit(1); }
const res = await writeMlbMatches(sql, league.id, all);
console.log(`APPLIED  inserted ${res.inserted} | updated ${res.updated} | refused ${res.refused.length}`);
