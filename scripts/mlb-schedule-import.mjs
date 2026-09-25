// scripts/mlb-schedule-import.mjs — MLB games into matches, a day at a time.
// DRY RUN BY DEFAULT.
//
//   set -a && . ./.env.local && set +a
//   node scripts/mlb-schedule-import.mjs --prod 2026-09-22 2026-09-23
//   node scripts/mlb-schedule-import.mjs --prod --apply 2026-09-22
//   node scripts/mlb-schedule-import.mjs --prod --apply --postseason 2026
//   node scripts/mlb-schedule-import.mjs --prod --apply --probables 2026-09-22
//
// --probables is a SECOND PASS over days already imported: it asks BDL's
// /mlb/v1/lineups for the announced starters (is_probable_pitcher) and writes
// them to metadata.probables, which is what the pre-game card and the game
// page's PROBABLES module read. The join is our row's own bdl_game_id - the
// game BDL gave us is the game we ask about, so a doubleheader has nothing to
// disambiguate.
//
// It runs again on every day of the season and once more when the postseason
// bracket is set, so it lives here rather than in a scratchpad.

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { fetchMlbDay, fetchMlbPostseason, slugsFor, shapeMlbMatch, writeMlbMatches } from '../lib/mlb/schedule.js';
import { fetchLineupRows, probablesFromLineupRows } from '../lib/mlb/probables.js';
import { writeMlbProbables } from '../lib/mlb/detail.js';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');
const POST = args.includes('--postseason');
const PROBABLES = args.includes('--probables');
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

// ---------------------------------------------------------------------------
// --probables: the second pass. Days already imported, starters written.
// ---------------------------------------------------------------------------
if (PROBABLES) {
  let wrote = 0; const noId = []; const unannounced = [];
  for (const day of rest) {
    // OUR ROWS FOR THAT DAY, in ET - the same boundary the slate uses: a 01:45Z
    // first pitch belongs to the American day before it in UTC.
    const ours = await sql`
      SELECT m.id, m.slug, m.external_ids->>'bdl_game_id' AS bdl,
             a.abbreviation AS away, h.abbreviation AS home
        FROM matches m
        JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
        LEFT JOIN teams h ON h.id = m.home_team_id
        LEFT JOIN teams a ON a.id = m.away_team_id
       WHERE m.kickoff_at AT TIME ZONE 'America/New_York' >= ${day}::date
         AND m.kickoff_at AT TIME ZONE 'America/New_York' <  ${day}::date + 1`;
    const rows = await fetchLineupRows(ours.map((m) => m.bdl).filter(Boolean));
    const byGame = new Map();
    for (const r of rows) {
      if (!byGame.has(String(r.game_id))) byGame.set(String(r.game_id), []);
      byGame.get(String(r.game_id)).push(r);
    }
    console.log(`${day}: ${ours.length} of our rows | ${byGame.size} BDL games with lineup rows`);
    for (const m of ours) {
      if (!m.bdl) { noId.push(m.slug); continue; }
      const p = probablesFromLineupRows(byGame.get(String(m.bdl)) ?? [], { awayAbbr: m.away, homeAbbr: m.home });
      if (!p) { unannounced.push(m.slug); continue; }
      console.log(`  ${m.slug.padEnd(30)} ${p.away?.name ?? 'TBA'} vs ${p.home?.name ?? 'TBA'}`);
      if (APPLY && await writeMlbProbables(sql, m.id, p)) wrote += 1;
    }
  }
  console.log(`\n${APPLY ? `APPLIED  probables written ${wrote}` : 'DRY RUN ONLY.'}`);
  if (noId.length) console.log(`no bdl_game_id: ${noId.join(', ')}`);
  if (unannounced.length) console.log(`no starter announced on BDL: ${unannounced.join(', ')}`);
  process.exit(0);
}

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
