// scripts/map-apisports-teams.mjs
//
// Writes external_ids.apisports_team_id onto gridiron `teams` rows, so the
// importer can resolve a game's two teams by provider id instead of by name at
// insert time. Name matching belongs HERE, once, under a human's eye - not in a
// poller running against a live slate at 7pm.
//
// DRY RUN BY DEFAULT. Nothing is written without --write.
//
//   node scripts/map-apisports-teams.mjs                    # dev,  dry run
//   node scripts/map-apisports-teams.mjs --write            # dev,  writes
//   node scripts/map-apisports-teams.mjs --prod             # prod, dry run
//   node scripts/map-apisports-teams.mjs --prod --write     # prod, writes
//
// MATCHING IS EXACT-NAME ONLY, AND THAT IS THE POINT. All 32 NFL teams match
// exactly (verified), so a fuzzy fallback would only ever fire on a name the
// provider changed - exactly the case where a wrong guess is worse than a
// reported miss. An unmatched team is REPORTED and left alone; the script exits
// non-zero so a partial map cannot pass for a complete one.
//
// Merge semantics: external_ids is patched with `||`, never replaced, so
// bdl_team_id and anything else already on the row survive.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvLocal() {
  let text;
  try { text = readFileSync(path.join(REPO, '.env.local'), 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvLocal();

const WRITE = process.argv.includes('--write');
const PROD = process.argv.includes('--prod');
const SEASON = 2026;

const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error(`${PROD ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} missing`);
const sql = neon(url);

const KEY = process.env.API_SPORTS_KEY;
if (!KEY) throw new Error('API_SPORTS_KEY missing');

// Both gridiron leagues, so the same script serves CFB when its ids are wanted.
// league: our slug -> API-Sports league id.
const LEAGUES = { nfl: 1, cfb: 2 };

async function apiTeams(leagueId) {
  const res = await fetch(
    `https://v1.american-football.api-sports.io/teams?league=${leagueId}&season=${SEASON}`,
    { headers: { 'x-apisports-key': KEY } },
  );
  const json = await res.json();
  const e = json.errors;
  if (e && (Array.isArray(e) ? e.length : Object.keys(e).length)) {
    throw new Error(`API-Sports /teams error: ${JSON.stringify(e)}`);
  }
  // The provider's NFL list carries two conference all-star entries alongside
  // the 32 clubs. They are not teams we hold and are dropped by the exact-name
  // match anyway; excluded here so the counts in the report mean something.
  return (json.response ?? []).filter((t) => !t.national);
}

// DEFAULTS TO NFL, deliberately. CFB is supported (--league=cfb) but does NOT
// map cleanly: 221 of our 230 teams match by exact name and nine do not - App
// State, Massachusetts, Buffalo, Rice, Alabama A&M, Jackson State among them,
// where the two sources disagree on abbreviation-vs-full-name conventions.
// Reconciling those is its own task with its own evidence, and until it is done
// a default run that covered CFB would exit non-zero every time and train
// everyone to ignore the failure. NFL is what preseason needs and NFL is clean.
const only = process.argv.find((a) => a.startsWith('--league='))?.split('=')[1] ?? null;
const targets = only ? [only] : ['nfl'];

console.log(`target: ${PROD ? 'PROD' : 'DEV'}  ${new URL(url).hostname}`);
console.log(`mode:   ${WRITE ? 'WRITE' : 'DRY RUN'}   season ${SEASON}   leagues: ${targets.join(', ')}\n`);

let unmatchedTotal = 0;

for (const slug of targets) {
  const leagueId = LEAGUES[slug];
  if (!leagueId) { console.log(`skip unknown league '${slug}'`); continue; }

  const api = await apiTeams(leagueId);
  const ours = await sql`
    SELECT t.id, t.name, t.abbreviation, t.external_ids
      FROM teams t JOIN leagues l ON l.id = t.league_id
     WHERE l.slug = ${slug} ORDER BY t.name`;

  const byName = new Map(api.map((a) => [a.name.toLowerCase(), a]));
  const matched = [];
  const unmatched = [];
  for (const t of ours) {
    const hit = byName.get(t.name.toLowerCase());
    if (hit) matched.push({ t, hit });
    else unmatched.push(t);
  }

  const already = matched.filter(({ t, hit }) => t.external_ids?.apisports_team_id === String(hit.id));
  const toWrite = matched.filter(({ t, hit }) => t.external_ids?.apisports_team_id !== String(hit.id));

  console.log(`--- ${slug} ---`);
  console.log(`  api teams: ${api.length}   ours: ${ours.length}`);
  console.log(`  exact-name matched: ${matched.length}   already correct: ${already.length}   to write: ${toWrite.length}   UNMATCHED: ${unmatched.length}`);

  for (const t of unmatched) console.log(`    UNMATCHED  ${t.name} (${t.abbreviation ?? '-'})`);
  for (const { t, hit } of toWrite.slice(0, 40)) {
    console.log(`    ${WRITE ? 'write' : 'would'}  ${String(t.id).padStart(6)}  ${t.name.padEnd(24)} -> apisports_team_id=${hit.id} (${hit.code ?? '-'})`);
  }
  if (toWrite.length > 40) console.log(`    ... and ${toWrite.length - 40} more`);

  if (WRITE) {
    let n = 0;
    for (const { t, hit } of toWrite) {
      await sql`
        UPDATE teams
           SET external_ids = COALESCE(external_ids, '{}'::jsonb) || ${JSON.stringify({ apisports_team_id: String(hit.id) })}::jsonb,
               updated_at = now()
         WHERE id = ${t.id}`;
      n++;
    }
    console.log(`  WROTE ${n} rows`);
  }

  unmatchedTotal += unmatched.length;
  console.log();
}

if (unmatchedTotal > 0) {
  console.error(`FAIL: ${unmatchedTotal} team(s) unmatched - a partial map must not read as a complete one.`);
  process.exitCode = 1;
} else {
  console.log(WRITE ? 'All teams mapped.' : 'All teams would map. Re-run with --write.');
}
