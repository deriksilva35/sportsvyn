#!/usr/bin/env node
// scripts/fantrax-import.mjs — the committed, re-runnable Fantrax import entry.
//
// WHY THIS FILE EXISTS. importFantraxLeague had exactly ONE reference in the
// repo — its own definition. No route, no cron, no script. The 1 Sep import was
// run from an ad-hoc entry that was never written down, which is how the college
// half of the board could ship, be verified, and still not exist in production:
// nothing triggered it. By the repo's own rule this is what scripts/ is for —
// it will be run again on a future slate.
//
// THE CREDENTIAL COMES FROM THE ENVIRONMENT, ALWAYS. Source it and let the
// process inherit it; never a connection string on a command line or in a
// default argument:
//     set -a && . ./.env.local && set +a
//     node scripts/fantrax-import.mjs --league <id>              # dry run
//     node scripts/fantrax-import.mjs --league <id> --apply      # writes
//
// ---------------------------------------------------------------------------
// TWO MODES, AND THE DIFFERENCE MATTERS MORE THAN IT LOOKS.
//
//   --pool-only (DEFAULT)  Writes the player pool ONLY: both leagues, into a
//                          fresh snapshot for (date, format, teams, 'fantrax'),
//                          then resolves identities. Touches NO config, NO
//                          keepers, NO members. This is all that is needed for a
//                          NEW draft on an EXISTING config to see college
//                          players, because the pool is keyed by the snapshot
//                          tuple and not by config id.
//
//   --full                 Runs importFantraxLeague, which INSERTS A BRAND NEW
//                          draft_configs ROW. It does not update the config you
//                          already have — there is no upsert on
//                          external_league_id (that is a queued item). So a
//                          --full run against a league that is already imported
//                          produces a DUPLICATE config with its own keepers and
//                          its own owner membership, and every draft on the old
//                          config stays on the old config. Measured 2 Sep 2026:
//                          config 225 carries 41 keepers, 3 members and 18
//                          drafts; a --full run would leave all of that behind
//                          and hand you config 226.
//
// So --pool-only is the mode that refreshes a league you already have, and
// --full is for importing one you do not. The default is the safe one.
// ---------------------------------------------------------------------------

import { neon } from '@neondatabase/serverless';
import * as api from '../lib/fantrax/api.js';
import {
  buildCrosswalk, toPoolRows, toCollegePoolRows, heldByLeague, importFantraxLeague,
} from '../lib/fantrax/import.js';
import { toRosterSlots, toScoringFormat } from '../lib/fantrax/vocabulary.js';
import { matchPoolIdentities } from '../lib/gridiron/nameMatch.js';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = null) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : d; };

const APPLY = has('--apply');
const FULL = has('--full');
const LEAGUE = val('--league');
const USER = val('--user');
const DB = has('--dev') ? 'DATABASE_URL' : 'PROD_DATABASE_URL';

function usage(msg) {
  console.error(`\n${msg}\n
  node scripts/fantrax-import.mjs --league <leagueId> [--apply] [--full] [--dev] [--user <id>]

    --league   Fantrax leagueId (required)
    --apply    actually write; without it this is a DRY RUN and touches nothing
    --full     run the whole importFantraxLeague — CREATES A NEW CONFIG. Needs --user.
               Omit it (the default) to refresh the pool only, which is what an
               already-imported league wants.
    --dev      target DATABASE_URL instead of PROD_DATABASE_URL
    --user     user id, required by --full (the config's owner)

  Source the credential first:  set -a && . ./.env.local && set +a\n`);
  process.exit(1);
}
if (!LEAGUE) usage('--league is required.');
if (FULL && !USER) usage('--full creates a config and needs --user <id>.');
const url = process.env[DB];
if (!url) usage(`${DB} is not set in the environment.`);

const sql = neon(url);
const today = new Date().toISOString().slice(0, 10);

// THE TARGET IS ANNOUNCED BEFORE ANYTHING ELSE HAPPENS, including before the
// provider is called, so a run against the wrong database is visible in the
// first line of output rather than in its results.
console.log('='.repeat(74));
console.log(`TARGET   ${DB}  ->  ${new URL(url).host}`);
console.log(`LEAGUE   ${LEAGUE}`);
console.log(`MODE     ${FULL ? 'FULL (creates a new config)' : 'POOL ONLY (no config touched)'}`);
console.log(`WRITES   ${APPLY ? 'YES — --apply given' : 'NO — dry run'}`);
console.log('='.repeat(74));

const census = async (label) => {
  const rows = await sql`SELECT snapshot_date, league, count(*) n, count(ncaaf_adp) priced,
      min(adp) lo, max(adp) hi
    FROM sim_player_pool WHERE source='fantrax' GROUP BY 1,2 ORDER BY 1 DESC, 2`;
  console.log(`\n${label}`);
  if (!rows.length) console.log('   (no fantrax rows at all)');
  for (const r of rows) {
    console.log(`   ${String(r.snapshot_date).slice(0, 10)}  ${String(r.league).padEnd(5)} ` +
      `${String(r.n).padStart(5)} rows  ${String(r.priced).padStart(4)} priced  adp ${r.lo}..${r.hi}`);
  }
  return rows;
};

const configState = async () => (await sql`
  SELECT id, name, external_league_id,
    (SELECT count(*) FROM draft_config_keepers k WHERE k.config_id=c.id) keepers,
    (SELECT count(*) FROM draft_config_members m WHERE m.config_id=c.id) members,
    (SELECT count(*) FROM drafts d WHERE d.config_id=c.id) drafts,
    jsonb_array_length(COALESCE(teams,'[]'::jsonb)) teams
  FROM draft_configs c WHERE source='fantrax' ORDER BY id`);

const showConfigs = (label, rows) => {
  console.log(`\n${label}`);
  for (const r of rows) {
    console.log(`   config ${r.id}  "${r.name}"  league ${r.external_league_id}  ` +
      `keepers ${r.keepers}  members ${r.members}  drafts ${r.drafts}  teams ${r.teams}`);
  }
};

await census('POOL BEFORE');
const cfgBefore = await configState();
showConfigs('CONFIGS BEFORE', cfgBefore);

// ---- the provider, read once ------------------------------------------------
console.log('\nfetching Fantrax…');
const [leagues, info, playerIds, ncaafIds, nflAdp, ncaafAdp] = await Promise.all([
  api.getLeagues(), api.getLeagueInfo(LEAGUE, { excludePlayerInfo: false }),
  api.getPlayerIds('NFL'), api.getPlayerIds('NCAAF'), api.getAdp(), api.getAdp('NCAAF'),
]);
const mine = leagues.find((l) => l.leagueId === LEAGUE);
if (!mine) { console.error(`league ${LEAGUE} is not on this account.`); process.exit(1); }
const scoring = toScoringFormat(info);
if (!scoring.ok) { console.error(scoring.error); process.exit(1); }
const { slots, unmapped } = toRosterSlots(info.rosterInfo);
if (unmapped.length) { console.error(`unmapped roster positions: ${unmapped.join(', ')}`); process.exit(1); }
const teamsCount = Object.keys(info.teamInfo ?? {}).length;

console.log(`  "${mine.leagueName}"  ${scoring.format} / ${teamsCount} teams  slots ${JSON.stringify(slots)}`);
console.log(`  getAdp() ${nflAdp.length} rows   getAdp('NCAAF') ${ncaafAdp.length} rows`);

if (FULL) {
  if (!APPLY) {
    console.log('\nDRY RUN — --full would run importFantraxLeague and INSERT A NEW CONFIG.');
    console.log(`  existing configs for this league: ${cfgBefore.filter((c) => c.external_league_id === LEAGUE).map((c) => c.id).join(', ') || 'none'}`);
    console.log('  Nothing written. Re-run with --apply to proceed.');
    process.exit(0);
  }
  const res = await importFantraxLeague(sql, { userId: Number(USER), leagueId: LEAGUE });
  console.log('\nimportFantraxLeague ->', JSON.stringify({
    ok: res.ok, reason: res.reason, error: res.error, configId: res.configId,
    poolWritten: res.poolWritten, collegeWritten: res.collegeWritten,
    poolMatched: res.poolMatched, keepers: res.keepers, minors: res.minors,
  }, null, 1));
  if (!res.ok) process.exit(1);
} else {
  // ---- pool only ------------------------------------------------------------
  const opts = { snapshotDate: today, scoringFormat: scoring.format, teamsCount, slots };
  const held = heldByLeague(info.playerInfo);
  const { rows: nfl, draftable, excluded } = toPoolRows(nflAdp, buildCrosswalk(playerIds), { ...opts, exclude: held });
  const { rows: col, skipped } = toCollegePoolRows(ncaafAdp, buildCrosswalk(ncaafIds), opts);
  console.log(`\nwould write snapshot ${today}:  nfl ${nfl.length} (of ${draftable} draftable, ${excluded} already rostered)` +
    `   ncaaf ${col.length} (${skipped.length} undraftable positions)`);
  if (col.length) {
    console.log(`  college placements ${col[0].adp}..${col[col.length - 1].adp}; top of that board:`);
    for (const r of col.filter((x) => x.position !== 'DEF').slice(0, 5)) {
      console.log(`    ${String(r.adp).padStart(5)}  ${r.position.padEnd(3)} ${String(r.team).padEnd(6)} ${r.name.padEnd(20)} NCAAF ADP ${r.ncaaf_adp}`);
    }
  }
  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply to write this snapshot.');
    console.log('  It would touch sim_player_pool only: no config, no keepers, no members.');
    process.exit(0);
  }
  // THE SNAPSHOT IS REPLACED, NOT MERGED, for this source's key — the same rule
  // the importer follows, and for the same reason: an upsert cannot remove a
  // row, so yesterday's rostered-then-freed players would linger on the board.
  await sql.transaction([
    sql`DELETE FROM sim_player_pool
         WHERE source='fantrax' AND snapshot_date=${today}
           AND scoring_format=${scoring.format} AND teams_count=${teamsCount}`,
    ...[...nfl, ...col].map((r) => sql`
      INSERT INTO sim_player_pool (snapshot_date, scoring_format, teams_count, ffc_player_id,
                                   name, position, team, adp, source, league, ncaaf_adp)
      VALUES (${r.snapshot_date}, ${r.scoring_format}, ${r.teams_count}, ${r.ffc_player_id},
              ${r.name}, ${r.position}, ${r.team}, ${r.adp}, ${r.source}, ${r.league},
              ${r.ncaaf_adp ?? null})`),
  ]);
  // STEP 2 IS NOT OPTIONAL — a pool row with no identity shows '-' in every
  // stat cell until something resolves it. Scoped to league='nfl' inside.
  const match = await matchPoolIdentities(sql);
  console.log(`\nwrote ${nfl.length + col.length} rows; matcher: ${match.counts.matched} matched, ` +
    `${match.unmatched.length} unmatched, ${match.ambiguous.length} ambiguous`);
}

await census('POOL AFTER');
const cfgAfter = await configState();
showConfigs('CONFIGS AFTER', cfgAfter);

// ---- what changed beyond the pool ------------------------------------------
console.log('\nBEYOND THE POOL');
const beforeById = new Map(cfgBefore.map((c) => [c.id, c]));
let moved = 0;
for (const a of cfgAfter) {
  const b = beforeById.get(a.id);
  if (!b) { console.log(`   NEW config ${a.id} "${a.name}" — keepers ${a.keepers}, members ${a.members}, teams ${a.teams}`); moved++; continue; }
  for (const k of ['keepers', 'members', 'drafts', 'teams', 'name']) {
    if (String(b[k]) !== String(a[k])) { console.log(`   config ${a.id}: ${k} ${b[k]} -> ${a[k]}`); moved++; }
  }
}
if (!moved) console.log('   nothing — no config, keeper, member or draft row changed.');
console.log('');
