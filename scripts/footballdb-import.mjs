#!/usr/bin/env node
// scripts/footballdb-import.mjs — footballdb season workbooks -> nfl_player_season_totals.
//
// ONE INVOCATION, ANY RANGE OF SEASONS. Unlike the BDL backfill this reads
// local files, not a paginated API, so there is no reason to force one season
// per process — the whole 1980-1999 range runs in well under a minute of
// local parsing plus one round trip per row written.
//
// Usage:
//   set -a && . ./.env.local && set +a
//   node scripts/footballdb-import.mjs                     # 1980-1999, dry run
//   node scripts/footballdb-import.mjs 1995                # one season, dry run
//   node scripts/footballdb-import.mjs 1980-1988            # a range, dry run
//   node scripts/footballdb-import.mjs 1995 --apply          # writes
//
// ATOMIC PER SEASON (--apply). Every write for one season - the nfl_players
// mints in resolveAndPersistIdentity AND the season_totals upserts - runs in ONE
// transaction on a pg Client (lib/footballdb/seasonTxn.js); the candidate index
// is built inside it so it sees that season's own mints. Any error rolls the
// whole season back, the script names the season and exits non-zero, and
// nothing of that season is left behind. Seasons that already completed stay
// committed (a range is NOT one transaction). A dry run never opens a
// transaction and its output is unchanged.
//
// TARGET DATABASE is whatever DATABASE_URL points at - no --prod flag, no
// connection string in this file, same discipline as every other script here.
// Source with `set -a && . ./.env.local && set +a`; to hit PROD, export
// DATABASE_URL="$PROD_DATABASE_URL" first. The fingerprint printed at startup
// identifies the target without echoing the credential.

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sql } from '../lib/db.js';
import { inSeasonTransaction, upsertSeasonTotal } from '../lib/footballdb/seasonTxn.js';
import { readWorkbook, readAboutLines } from '../lib/footballdb/xlsxReader.js';
import { toSeasonRows, teamCountFromAbout } from '../lib/footballdb/parse.js';
import { loadCandidateIndex, loadEvidence, addEvidence, resolveAndPersistIdentity, inferPosition } from '../lib/footballdb/identity.js';
import { canonicalTeamKey } from '../lib/footballdb/teamKey.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKBOOK_DIR = path.join(__dirname, '..', '.data', 'footballdb', 'NFL_Player_Stats_1980-1999');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const rangeArg = args.find((a) => /^\d{4}(-\d{4})?$/.test(a));
let seasons;
if (!rangeArg) seasons = Array.from({ length: 20 }, (_, i) => 1980 + i);
else if (rangeArg.includes('-')) {
  const [lo, hi] = rangeArg.split('-').map(Number);
  seasons = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
} else seasons = [Number(rangeArg)];

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const fingerprint = crypto.createHash('sha256').update(String(process.env.DATABASE_URL)).digest('hex').slice(0, 12);
console.log('='.repeat(74));
console.log(`TARGET   DATABASE_URL -> ${new URL(process.env.DATABASE_URL).host}`);
console.log(`FINGERPRINT   ${fingerprint}`);
console.log(`SEASONS  ${seasons[0]}-${seasons.at(-1)} (${seasons.length})`);
console.log(`WRITES   ${apply ? 'YES — --apply given' : 'NO — dry run'}`);
console.log('='.repeat(74));

// ONE CANONICAL team_key, PRODUCED BEFORE THE CONFLICT KEY IS BUILT
// (ruling). A resolver built once (teams.name -> teams.abbreviation, nfl
// league, case-insensitive - the same join scripts/team-key-abbreviate.mjs
// used) and handed to lib/footballdb/teamKey.js's canonicalTeamKey(), the
// ONE function that decides team_key's stored shape. Doing this HERE, before
// every INSERT ... ON CONFLICT (nfl_player_id, season_year, team_key),
// is what makes a re-run idempotent against whatever a prior run (or
// scripts/team-key-abbreviate.mjs) already wrote - the old bug was building
// the conflict key from the raw name every time, missing a row someone else
// had already abbreviated in place.
const nflTeams = await sql`SELECT t.name, t.abbreviation FROM teams t JOIN leagues l ON l.id = t.league_id WHERE l.slug = 'nfl'`;
const teamByName = new Map(nflTeams.map((t) => [t.name.toLowerCase(), t.abbreviation]));
const teamResolver = (name) => teamByName.get(name.toLowerCase()) ?? null;

const totals = { rows: 0, written: 0, exact: 0, byContext: 0, created: 0, ambiguous: 0, defenseOnly: 0, gamesConflict: 0 };
// This run's own resolved rows, so 2001 sees 2000's teams (ids known: exact, and created on --apply).
const runEvidence = [];
const allAmbiguous = [];
const allRefusedPositionless = [];

const client = apply ? new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
if (client) await client.connect();

for (const year of seasons) {
  const file = path.join(WORKBOOK_DIR, `NFL_${year}_Player_Stats.xlsx`);
  const workbook = readWorkbook(file);
  const aboutLines = readAboutLines(file);
  const teamCount = teamCountFromAbout(aboutLines);
  const seasonRows = toSeasonRows(workbook);

  // The season's whole write path. `db` is the neon sql on a dry run (apply is
  // false: reads only) or the transaction adapter on --apply.
  const processSeason = async (db) => {
    const candidateIndex = await loadCandidateIndex(db);
    const evidence = await loadEvidence(db);
    for (const e of runEvidence) addEvidence(evidence, e.id, e.year, e.team);

    let exact = 0; let byContext = 0; let created = 0; let ambiguous = 0; let defenseOnly = 0; let gamesConflict = 0;
    const written = [];
    const ambiguousRows = [];
    const byTab = { Passing: 0, Rushing: 0, Receiving: 0, Kicking: 0, Defense: 0 };
    for (const r of seasonRows) {
      if (r.passAtt != null) byTab.Passing += 1;
      if (r.rushAtt != null) byTab.Rushing += 1;
      if (r.rec != null) byTab.Receiving += 1;
      if (r.fgm != null || r.fga != null) byTab.Kicking += 1;
      if (r.defInt != null || r.defTd != null || r.sacks != null) byTab.Defense += 1;
      if (r.gamesConflict) gamesConflict += 1;

      const position = inferPosition(r);
      if (position == null) { defenseOnly += 1; continue; } // no slot in QB/RB/WR/TE/FLEX/PK/DEF

      // ONE FUNCTION DOES THE RESOLVE AND THE WRITE IT IMPLIES
      // (lib/footballdb/identity.js's resolveAndPersistIdentity). A same-name
      // tie is broken by team-season context (fri-11); a tie it cannot break
      // is AMBIGUOUS: nothing is minted, the row is SKIPPED and reported.
      const teamKey = canonicalTeamKey(r.team, teamResolver);
      const resolved = await resolveAndPersistIdentity(db, r.rawName, position, candidateIndex,
        { apply, context: { year, team: teamKey, evidence } });
      const { nflPlayerId, matchedBy } = resolved;

      if (resolved.outcome === 'ambiguous') {
        ambiguous += 1;
        ambiguousRows.push({ year, rawName: r.rawName, team: r.team, candidateIds: resolved.candidateIds });
        continue;
      }
      if (resolved.outcome === 'created') created += 1;
      else { exact += 1; if (resolved.via) byContext += 1; }
      if (nflPlayerId != null) { addEvidence(evidence, nflPlayerId, year, teamKey); runEvidence.push({ id: nflPlayerId, year, team: teamKey }); }

      written.push({
        nflPlayerId, season_year: year, team_key: teamKey, position: resolved.position ?? position,
        games: r.games ?? null, pass_cmp: r.passCmp ?? null, pass_att: r.passAtt ?? null,
        pass_yds: r.passYds ?? null, pass_td: r.passTd ?? null, pass_int: r.passInt ?? null,
        rush_att: r.rushAtt ?? null, rush_yds: r.rushYds ?? null, rush_td: r.rushTd ?? null,
        rush_long: r.rushLong ?? null,
        rec: r.rec ?? null, rec_yds: r.recYds ?? null, rec_td: r.recTd ?? null,
        rec_long: r.recLong ?? null,
        fgm: r.fgm ?? null, fga: r.fga ?? null, fg_long: r.fgLong ?? null, xp: r.xp ?? null,
        sacks: r.sacks ?? null, def_int: r.defInt ?? null, def_td: r.defTd ?? null,
        matched_by: matchedBy, raw_name: r.rawName,
      });
    }
    if (apply) for (const w of written) await upsertSeasonTotal(db, w);
    return { exact, byContext, created, ambiguous, defenseOnly, gamesConflict, written, ambiguousRows, byTab };
  };

  let result;
  if (apply) {
    try {
      result = await inSeasonTransaction(client, processSeason);
    } catch (err) {
      console.error(`\nSEASON ${year} FAILED - rolled back, nothing of ${year} written: ${err.message}`);
      await client.end().catch(() => {});
      process.exit(1);
    }
  } else {
    result = await processSeason(sql);
  }
  const { exact, byContext, created, ambiguous, defenseOnly, gamesConflict, written, ambiguousRows, byTab } = result;

  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '0%');
  console.log(`\n${year}  teams(About)=${teamCount}  rows(tabs merged)=${seasonRows.length}  ` +
    `by-tab: Pass=${byTab.Passing} Rush=${byTab.Rushing} Rec=${byTab.Receiving} Kick=${byTab.Kicking} Def=${byTab.Defense}`);
  console.log(`   written=${written.length}  exact=${exact} (${pct(exact, written.length)}; ${byContext} by team-season context)  ` +
    `created=${created} (${pct(created, written.length)})  ambiguous-skipped=${ambiguous}  ` +
    `defenseOnly(no slot, not written)=${defenseOnly}  gamesConflict=${gamesConflict}`);
  if (ambiguousRows.length) {
    console.log('   AMBIGUOUS - SKIPPED, not written, no player created (same name, context cannot tell them apart):');
    for (const a of ambiguousRows) console.log(`      ${a.rawName} (${a.team}) -> candidates ${JSON.stringify(a.candidateIds)}`);
  }

  totals.rows += seasonRows.length; totals.written += written.length; totals.exact += exact; totals.byContext += byContext; totals.created += created;
  totals.ambiguous += ambiguous; totals.defenseOnly += defenseOnly; totals.gamesConflict += gamesConflict;
  allAmbiguous.push(...ambiguousRows);
}

console.log('\n' + '='.repeat(74));
console.log(`TOTALS ${seasons[0]}-${seasons.at(-1)}: rows=${totals.rows} written=${totals.written} exact=${totals.exact} (by context ${totals.byContext}) created=${totals.created} ` +
  `ambiguous-skipped=${totals.ambiguous} defenseOnly=${totals.defenseOnly} gamesConflict=${totals.gamesConflict}`);
console.log(apply ? 'WROTE to the database.' : 'DRY RUN — nothing written. Re-run with --apply to write.');
if (client) await client.end();
