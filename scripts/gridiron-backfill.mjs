// scripts/gridiron-backfill.mjs — ONE-OFF DEV backfill, deliberately untracked.
// NOT because scripts/ is excluded from git: it is not, and 44 .mjs files are
// tracked there already. This one stays out because it answered a single
// evening's question and the test is reuse, not size. Reusable logic lives in
// lib/gridiron/sync.js.
//
// Run (keys inline, never written to a file):
//   BDL_API_KEY=... CFBD_API_KEY=... node scripts/gridiron-backfill.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(path.resolve(__dirname, '..', '.env.local'));
if (new URL(process.env.DATABASE_URL).hostname.includes('winter-dawn')) throw new Error('REFUSE: PROD');

const { neon } = await import('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const { bootstrapLeagues, syncNflTeams, syncCfbTeams, syncNflGames, syncCfbGames } = await import('../lib/gridiron/sync.js');
const j = (o) => JSON.stringify(o);
const countMatches = async (lid) => (await sql`SELECT count(*)::int n FROM matches WHERE league_id = ${lid}`)[0].n;

console.log('=== C.1 league bootstrap ===');
const { nfl, cfb } = await bootstrapLeagues();
console.log('  nfl:', j(nfl));
console.log('  cfb:', j(cfb));

console.log('\n=== C.2/C.3 teams ===');
console.log('  syncNflTeams:', j(await syncNflTeams(nfl.id, 2025)));
console.log('  syncCfbTeams:', j(await syncCfbTeams(cfb.id, 2025)));

console.log('\n=== D.1/D.2 games — pass 1 ===');
const nflSum1 = await syncNflGames(nfl.id, 2025);
console.log('  syncNflGames:', j(nflSum1));
const cfbSum1 = await syncCfbGames(cfb.id, 2025);
console.log('  syncCfbGames:', j(cfbSum1));
const nflN1 = await countMatches(nfl.id), cfbN1 = await countMatches(cfb.id);
console.log(`  matches after pass 1 — nfl=${nflN1} cfb=${cfbN1}`);

console.log('\n=== D.3 idempotency — pass 2 (re-run games) ===');
const nflSum2 = await syncNflGames(nfl.id, 2025);
const cfbSum2 = await syncCfbGames(cfb.id, 2025);
const nflN2 = await countMatches(nfl.id), cfbN2 = await countMatches(cfb.id);
console.log(`  matches after pass 2 — nfl=${nflN2} cfb=${cfbN2}`);
console.log(`  IDEMPOTENT nfl: ${nflN1 === nflN2 ? 'YES' : 'NO (dupes!)'}   cfb: ${cfbN1 === cfbN2 ? 'YES' : 'NO (dupes!)'}`);
console.log(`  pass2 ingested (updates): nfl=${nflSum2.ingested} cfb=${cfbSum2.ingested}`);

console.log('\n=== E.2 VERIFICATION ===');
const perPhase = await sql`
  SELECT l.slug, m.season_phase, count(*)::int n, min(m.week) minw, max(m.week) maxw
    FROM matches m JOIN leagues l ON l.id = m.league_id
   WHERE m.season_year = 2025 GROUP BY l.slug, m.season_phase ORDER BY l.slug, m.season_phase`;
console.log('  counts + week ranges per league/phase:');
perPhase.forEach((r) => console.log(`    ${r.slug}/${r.season_phase}: ${r.n} games, week ${r.minw}-${r.maxw}`));

const nullKo = (await sql`SELECT count(*)::int n FROM matches WHERE season_year IS NOT NULL AND kickoff_at IS NULL`)[0].n;
console.log(`  gridiron rows with NULL kickoff_at: ${nullKo} (expect 0)`);
const unknown = (nflSum1.unknownStatus + cfbSum1.unknownStatus);
console.log(`  unknownStatus across pass-1 summaries: ${unknown} (expect 0)`);
console.log(`  nfl missingTeam: ${nflSum1.missingTeam}; cfb fcsStubsCreated: ${cfbSum1.fcsStubsCreated}; cfb skippedNonFbsGame: ${cfbSum1.skippedNonFbsGame}`);

const mem = await sql`SELECT l.slug, count(*)::int n FROM team_season_membership tsm JOIN leagues l ON l.id = tsm.league_id WHERE tsm.season_year = 2025 GROUP BY l.slug ORDER BY l.slug`;
console.log('  team_season_membership (2025):', mem.map((r) => `${r.slug}=${r.n}`).join(' '));
const teamCounts = await sql`SELECT l.slug, count(*)::int n FROM teams t JOIN leagues l ON l.id = t.league_id WHERE l.sport='football' GROUP BY l.slug ORDER BY l.slug`;
console.log('  football teams:', teamCounts.map((r) => `${r.slug}=${r.n}`).join(' '));

const wc = (await sql`SELECT count(*) FILTER (WHERE season_year IS NULL) untouched, count(*) FILTER (WHERE season_year IS NOT NULL) gridiron FROM matches m JOIN leagues l ON l.id=m.league_id WHERE l.slug='fifa-wc-2026'`)[0];
console.log(`  WC matches: untouched=${wc.untouched}, gridiron-tagged=${wc.gridiron} (expect gridiron=0)`);

console.log('  spot-check kickoff UTC vs reality:');
for (const [key, id, label, expect] of [
  ['bdl_game_id', '423945', 'NFL Wk1 opener DAL@PHI (Thu 9/4 8:20pm ET)', '2025-09-05T00:20:00'],
  ['bdl_game_id', '424009', 'NFL Wk5 SF@LAR (Thu 10/2 8:15pm ET)', '2025-10-03T00:15:00'],
  ['cfbd_game_id', '401756846', 'CFB Wk1 Iowa St@Kansas St (Dublin)', '2025-08-23T16:00:00'],
]) {
  const r = (await sql`SELECT slug, to_char(kickoff_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS') ko, status, season_phase, week FROM matches WHERE external_ids->>${key} = ${id} LIMIT 1`)[0];
  console.log(`    ${label}: ko=${r?.ko}Z ${r?.ko === expect ? 'OK' : 'MISMATCH vs ' + expect} [${r?.season_phase} w${r?.week} ${r?.status}]`);
}

// CFBD budget
const cfbdRes = await fetch('https://apinext.collegefootballdata.com/conferences', { headers: { Authorization: `Bearer ${process.env.CFBD_API_KEY}` } });
console.log(`\n  CFBD calllimit-remaining: ${cfbdRes.headers.get('x-calllimit-remaining')}`);
