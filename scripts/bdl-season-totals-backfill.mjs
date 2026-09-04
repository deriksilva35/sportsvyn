#!/usr/bin/env node
// scripts/bdl-season-totals-backfill.mjs — nfl_player_game_stats (2015-2025) ->
// nfl_player_season_totals, the modern half of the table footballdb's
// 1980-1999 workbooks fill for the historical half. See migrations/087 and
// migrations/088.
//
// GROUP BY (nfl_player_id, season_year, team_id). SUM every countable column.
// MAX, never SUM, on fg_long — the same rule 088 states for rush_long/rec_long,
// which have no per-game long to aggregate FROM in this table at all (NULL,
// not guessed). fumbles_lost is left NULL here too, on purpose, NOT summed
// even though nfl_player_game_stats.fumbles_lost is real data for this range —
// per the standing ruling, one scoring rule has to hold for all 46 seasons,
// and a modern-only fumble term would score 2024 boards by a different rule
// than 1985 boards. That gap gets its own future relay (nflverse, 1999+),
// its own ruling on the resulting 1980-98 vs 1999+ inconsistency.
//
// SCOPE MATCHES FOOTBALLDB'S OWN: only QB/RB/WR/TE/PK, is_team_defense=false.
// footballdb never writes an individual defensive player to this table
// (lib/footballdb/identity.js: inferPosition returns null for a defense-tab-
// only row) — matching that scope here, rather than writing the full set of
// nfl_player_game_stats defensive lines this ingest happens to have, keeps
// the two halves describing the same kind of row.
//
// TEAM_KEY: THE TEAM ABBREVIATION (ruling, 089), read straight off
// teams.abbreviation via gs.team_id — a real FK already on every game row, so
// this ALWAYS resolves for the BDL half; there is no string-matching, no
// misses possible, unlike the footballdb half (scripts/team-key-abbreviate.mjs
// handles that side, where only a raw name string exists). An earlier version
// of this script tried to preserve era-accurate FULL NAMES for the four
// franchises that renamed inside 2015-2025 (Rams, Chargers, Raiders,
// Washington) — moot now that team_key is an abbreviation: "LAR" or "LV" is
// not a historical claim about the season the way "Los Angeles Rams" would
// be for a 2015 (St. Louis) season, so there is nothing left to get wrong.
//
// Usage:
//   set -a && . ./.env.local && set +a
//   node scripts/bdl-season-totals-backfill.mjs                # 2015-2025, dry run
//   node scripts/bdl-season-totals-backfill.mjs 2015-2020       # a range, dry run
//   node scripts/bdl-season-totals-backfill.mjs --apply          # writes
//
// TARGET DATABASE is whatever DATABASE_URL points at - no --prod flag, no
// connection string in this file. To hit PROD, export
// DATABASE_URL="$PROD_DATABASE_URL" first.

import crypto from 'node:crypto';
import { sql } from '../lib/db.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const rangeArg = args.find((a) => /^\d{4}(-\d{4})?$/.test(a));
let lo = 2015; let hi = 2025;
if (rangeArg) {
  if (rangeArg.includes('-')) [lo, hi] = rangeArg.split('-').map(Number);
  else lo = hi = Number(rangeArg);
}

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const fingerprint = crypto.createHash('sha256').update(String(process.env.DATABASE_URL)).digest('hex').slice(0, 12);
console.log('='.repeat(74));
console.log(`TARGET   DATABASE_URL -> ${new URL(process.env.DATABASE_URL).host}`);
console.log(`FINGERPRINT   ${fingerprint}`);
console.log(`SEASONS  ${lo}-${hi}`);
console.log(`WRITES   ${apply ? 'YES — --apply given' : 'NO — dry run'}`);
console.log('='.repeat(74));

const rows = await sql`
  SELECT
    gs.nfl_player_id, m.season_year, gs.team_id, t.abbreviation AS team_abbr,
    np.position, np.full_name AS raw_name,
    COUNT(*)::int AS games,
    SUM(gs.pass_cmp)::int AS pass_cmp, SUM(gs.pass_att)::int AS pass_att,
    SUM(gs.pass_yds)::int AS pass_yds, SUM(gs.pass_td)::int AS pass_td, SUM(gs.pass_int)::int AS pass_int,
    SUM(gs.rush_att)::int AS rush_att, SUM(gs.rush_yds)::int AS rush_yds, SUM(gs.rush_td)::int AS rush_td,
    SUM(gs.rec)::int AS rec, SUM(gs.rec_yds)::int AS rec_yds, SUM(gs.rec_td)::int AS rec_td,
    SUM(gs.fgm)::int AS fgm, SUM(gs.fga)::int AS fga, MAX(gs.fg_long) AS fg_long, SUM(gs.xp)::int AS xp,
    SUM(gs.sacks) AS sacks, SUM(gs.def_int)::int AS def_int, SUM(gs.def_td)::int AS def_td
  FROM nfl_player_game_stats gs
  JOIN matches m ON m.id = gs.match_id
  JOIN leagues l ON l.id = m.league_id
  JOIN nfl_players np ON np.id = gs.nfl_player_id
  LEFT JOIN teams t ON t.id = gs.team_id
  WHERE l.slug = 'nfl' AND m.season_phase = 'REG'
    AND m.season_year BETWEEN ${lo} AND ${hi}
    AND np.is_team_defense = false AND np.position IN ('QB','RB','WR','TE','PK')
  GROUP BY gs.nfl_player_id, m.season_year, gs.team_id, t.abbreviation, np.position, np.full_name
  ORDER BY m.season_year, np.full_name`;

const noTeam = rows.filter((r) => r.team_id == null);
const usable = rows.filter((r) => r.team_id != null);

const written = usable.map((r) => ({
  nflPlayerId: r.nfl_player_id, season_year: r.season_year,
  team_key: r.team_abbr,
  position: r.position, games: r.games,
  pass_cmp: r.pass_cmp, pass_att: r.pass_att, pass_yds: r.pass_yds, pass_td: r.pass_td, pass_int: r.pass_int,
  rush_att: r.rush_att, rush_yds: r.rush_yds, rush_td: r.rush_td, rush_long: null,
  rec: r.rec, rec_yds: r.rec_yds, rec_td: r.rec_td, rec_long: null,
  fumbles_lost: null,
  fgm: r.fgm, fga: r.fga, fg_long: r.fg_long, xp: r.xp,
  sacks: r.sacks, def_int: r.def_int, def_td: r.def_td,
  matched_by: 'summed', raw_name: r.raw_name, source: 'bdl',
}));

if (apply && written.length) {
  for (const w of written) {
    await sql`
      INSERT INTO nfl_player_season_totals
        (nfl_player_id, season_year, team_key, position, games,
         pass_cmp, pass_att, pass_yds, pass_td, pass_int,
         rush_att, rush_yds, rush_td, rush_long, rec, rec_yds, rec_td, rec_long,
         fumbles_lost, fgm, fga, fg_long, xp, sacks, def_int, def_td,
         matched_by, raw_name, source)
      VALUES
        (${w.nflPlayerId}, ${w.season_year}, ${w.team_key}, ${w.position}, ${w.games},
         ${w.pass_cmp}, ${w.pass_att}, ${w.pass_yds}, ${w.pass_td}, ${w.pass_int},
         ${w.rush_att}, ${w.rush_yds}, ${w.rush_td}, ${w.rush_long},
         ${w.rec}, ${w.rec_yds}, ${w.rec_td}, ${w.rec_long},
         ${w.fumbles_lost}, ${w.fgm}, ${w.fga}, ${w.fg_long}, ${w.xp},
         ${w.sacks}, ${w.def_int}, ${w.def_td}, ${w.matched_by}, ${w.raw_name}, ${w.source})
      ON CONFLICT (nfl_player_id, season_year, team_key) DO UPDATE SET
        position = EXCLUDED.position, games = EXCLUDED.games,
        pass_cmp = EXCLUDED.pass_cmp, pass_att = EXCLUDED.pass_att, pass_yds = EXCLUDED.pass_yds,
        pass_td = EXCLUDED.pass_td, pass_int = EXCLUDED.pass_int,
        rush_att = EXCLUDED.rush_att, rush_yds = EXCLUDED.rush_yds, rush_td = EXCLUDED.rush_td,
        rush_long = EXCLUDED.rush_long,
        rec = EXCLUDED.rec, rec_yds = EXCLUDED.rec_yds, rec_td = EXCLUDED.rec_td,
        rec_long = EXCLUDED.rec_long,
        fumbles_lost = EXCLUDED.fumbles_lost,
        fgm = EXCLUDED.fgm, fga = EXCLUDED.fga, fg_long = EXCLUDED.fg_long, xp = EXCLUDED.xp,
        sacks = EXCLUDED.sacks, def_int = EXCLUDED.def_int, def_td = EXCLUDED.def_td,
        matched_by = EXCLUDED.matched_by, raw_name = EXCLUDED.raw_name, source = EXCLUDED.source`;
  }
}

console.log(`\nrows built=${written.length}   refused (no team_id)=${noTeam.length}`);
if (noTeam.length) {
  console.log('REFUSED (team_id NULL, not written):');
  for (const r of noTeam.slice(0, 20)) console.log(`   nfl_player_id=${r.nfl_player_id} season=${r.season_year} raw_name=${r.raw_name}`);
  if (noTeam.length > 20) console.log(`   ... and ${noTeam.length - 20} more`);
}

const bySeason = {};
for (const w of written) bySeason[w.season_year] = (bySeason[w.season_year] ?? 0) + 1;
console.log('\nby season:');
for (const y of Object.keys(bySeason).sort()) console.log(`   ${y}: ${bySeason[y]} rows`);

// A traded player shows as two+ rows sharing nfl_player_id but different
// team_key within the same season_year — print the first such case found.
const byPlayerSeason = {};
for (const w of written) {
  const k = `${w.nflPlayerId}|${w.season_year}`;
  (byPlayerSeason[k] ??= []).push(w);
}
const traded = Object.values(byPlayerSeason).find((g) => g.length > 1);

console.log('\nFIVE PRINTED ROWS (including a traded player as two rows, if found):');
const sample = [];
if (traded) sample.push(...traded);
for (const w of written) {
  if (sample.length >= 5) break;
  if (!sample.includes(w)) sample.push(w);
}
for (const w of sample.slice(0, 5)) {
  console.log(`   ${w.raw_name} (${w.position}) ${w.season_year} ${w.team_key} — ` +
    `${w.games}g, pass ${w.pass_cmp}/${w.pass_att} ${w.pass_yds}y ${w.pass_td}td, ` +
    `rush ${w.rush_att}/${w.rush_yds}y/${w.rush_td}td, rec ${w.rec}/${w.rec_yds}y/${w.rec_td}td, ` +
    `fg ${w.fgm}/${w.fga} (long ${w.fg_long}), xp ${w.xp}, sacks ${w.sacks}, def_int ${w.def_int}, def_td ${w.def_td}, ` +
    `matched_by=${w.matched_by} source=${w.source}`);
}

console.log('\n' + '='.repeat(74));
console.log(apply ? 'WROTE to the database.' : 'DRY RUN — nothing written. Re-run with --apply to write.');
