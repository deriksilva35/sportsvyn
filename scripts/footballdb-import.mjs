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
// TARGET DATABASE is whatever DATABASE_URL points at - no --prod flag, no
// connection string in this file, same discipline as every other script here.
// Source with `set -a && . ./.env.local && set +a`; to hit PROD, export
// DATABASE_URL="$PROD_DATABASE_URL" first. The fingerprint printed at startup
// identifies the target without echoing the credential.

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../lib/db.js';
import { readWorkbook, readAboutLines } from '../lib/footballdb/xlsxReader.js';
import { toSeasonRows, teamCountFromAbout } from '../lib/footballdb/parse.js';
import { loadCandidateIndex, resolveIdentity, createPlayer, inferPosition } from '../lib/footballdb/identity.js';
import { normalizeName } from '../lib/gridiron/nameMatch.js';

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

const totals = { rows: 0, exact: 0, created: 0, ambiguous: 0, defenseOnly: 0, gamesConflict: 0 };
const allAmbiguous = [];
const allRefusedPositionless = [];

for (const year of seasons) {
  const file = path.join(WORKBOOK_DIR, `NFL_${year}_Player_Stats.xlsx`);
  const workbook = readWorkbook(file);
  const aboutLines = readAboutLines(file);
  const teamCount = teamCountFromAbout(aboutLines);
  const seasonRows = toSeasonRows(workbook);

  const candidateIndex = await loadCandidateIndex(sql);

  let exact = 0; let created = 0; let ambiguous = 0; let defenseOnly = 0; let gamesConflict = 0;
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

    const resolved = resolveIdentity(r.rawName, position, candidateIndex);
    if (resolved.outcome === 'ambiguous') {
      ambiguous += 1;
      ambiguousRows.push({ year, rawName: r.rawName, team: r.team, candidateIds: resolved.candidateIds });
      continue;
    }

    let nflPlayerId = resolved.nflPlayerId;
    if (resolved.outcome === 'created') {
      created += 1;
      if (apply) {
        nflPlayerId = await createPlayer(sql, r.rawName, position);
        // Newly created players must be visible to LATER rows in this same
        // season (a name appearing on both Rushing and Defense, unlikely but
        // not impossible) and to subsequent seasons in this run.
        const norm = normalizeName(r.rawName);
        if (!candidateIndex.has(norm)) candidateIndex.set(norm, []);
        candidateIndex.get(norm).push({ id: nflPlayerId, position });
      }
    } else {
      exact += 1;
    }

    written.push({
      nflPlayerId, season_year: year, team_key: r.team, position: resolved.position ?? position,
      games: r.games ?? null, pass_cmp: r.passCmp ?? null, pass_att: r.passAtt ?? null,
      pass_yds: r.passYds ?? null, pass_td: r.passTd ?? null, pass_int: r.passInt ?? null,
      rush_att: r.rushAtt ?? null, rush_yds: r.rushYds ?? null, rush_td: r.rushTd ?? null,
      rush_long: r.rushLong ?? null,
      rec: r.rec ?? null, rec_yds: r.recYds ?? null, rec_td: r.recTd ?? null,
      rec_long: r.recLong ?? null,
      fgm: r.fgm ?? null, fga: r.fga ?? null, fg_long: r.fgLong ?? null, xp: r.xp ?? null,
      sacks: r.sacks ?? null, def_int: r.defInt ?? null, def_td: r.defTd ?? null,
      matched_by: resolved.outcome, raw_name: r.rawName,
    });
  }

  if (apply && written.length) {
    for (const w of written) {
      await sql`
        INSERT INTO nfl_player_season_totals
          (nfl_player_id, season_year, team_key, position, games,
           pass_cmp, pass_att, pass_yds, pass_td, pass_int,
           rush_att, rush_yds, rush_td, rush_long, rec, rec_yds, rec_td, rec_long,
           fgm, fga, fg_long, xp, sacks, def_int, def_td, matched_by, raw_name)
        VALUES
          (${w.nflPlayerId}, ${w.season_year}, ${w.team_key}, ${w.position}, ${w.games},
           ${w.pass_cmp}, ${w.pass_att}, ${w.pass_yds}, ${w.pass_td}, ${w.pass_int},
           ${w.rush_att}, ${w.rush_yds}, ${w.rush_td}, ${w.rush_long},
           ${w.rec}, ${w.rec_yds}, ${w.rec_td}, ${w.rec_long},
           ${w.fgm}, ${w.fga}, ${w.fg_long}, ${w.xp}, ${w.sacks}, ${w.def_int}, ${w.def_td},
           ${w.matched_by}, ${w.raw_name})
        ON CONFLICT (nfl_player_id, season_year, team_key) DO UPDATE SET
          position = EXCLUDED.position, games = EXCLUDED.games,
          pass_cmp = EXCLUDED.pass_cmp, pass_att = EXCLUDED.pass_att, pass_yds = EXCLUDED.pass_yds,
          pass_td = EXCLUDED.pass_td, pass_int = EXCLUDED.pass_int,
          rush_att = EXCLUDED.rush_att, rush_yds = EXCLUDED.rush_yds, rush_td = EXCLUDED.rush_td,
          rush_long = EXCLUDED.rush_long,
          rec = EXCLUDED.rec, rec_yds = EXCLUDED.rec_yds, rec_td = EXCLUDED.rec_td,
          rec_long = EXCLUDED.rec_long,
          fgm = EXCLUDED.fgm, fga = EXCLUDED.fga, fg_long = EXCLUDED.fg_long, xp = EXCLUDED.xp,
          sacks = EXCLUDED.sacks, def_int = EXCLUDED.def_int, def_td = EXCLUDED.def_td,
          matched_by = EXCLUDED.matched_by, raw_name = EXCLUDED.raw_name`;
    }
  }

  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '0%');
  console.log(`\n${year}  teams(About)=${teamCount}  rows(tabs merged)=${seasonRows.length}  ` +
    `by-tab: Pass=${byTab.Passing} Rush=${byTab.Rushing} Rec=${byTab.Receiving} Kick=${byTab.Kicking} Def=${byTab.Defense}`);
  console.log(`   written=${written.length}  exact=${exact} (${pct(exact, written.length)})  ` +
    `created=${created} (${pct(created, written.length)})  ambiguous=${ambiguous}  ` +
    `defenseOnly(no slot, not written)=${defenseOnly}  gamesConflict=${gamesConflict}`);
  if (ambiguousRows.length) {
    console.log('   AMBIGUOUS (refused, not written):');
    for (const a of ambiguousRows) console.log(`      ${a.rawName} (${a.team}) -> nfl_players ids ${JSON.stringify(a.candidateIds)}`);
  }

  totals.rows += seasonRows.length; totals.exact += exact; totals.created += created;
  totals.ambiguous += ambiguous; totals.defenseOnly += defenseOnly; totals.gamesConflict += gamesConflict;
  allAmbiguous.push(...ambiguousRows);
}

console.log('\n' + '='.repeat(74));
console.log(`TOTALS ${seasons[0]}-${seasons.at(-1)}: rows=${totals.rows} exact=${totals.exact} created=${totals.created} ` +
  `ambiguous=${totals.ambiguous} defenseOnly=${totals.defenseOnly} gamesConflict=${totals.gamesConflict}`);
console.log(apply ? 'WROTE to the database.' : 'DRY RUN — nothing written. Re-run with --apply to write.');
