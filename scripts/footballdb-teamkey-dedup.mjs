#!/usr/bin/env node
// scripts/footballdb-teamkey-dedup.mjs — one-time reconciliation of the
// same-team duplicate rows the pre-canonicalTeamKey() ingest created, plus
// re-keying any raw team_key the resolver can now abbreviate.
//
// SCOPE: SAME-TEAM DUPLICATES ONLY. A (nfl_player_id, season_year) pair with
// two DIFFERENT canonical teams is a real mid-season trade (migrations/089's
// own ruling: two rows, on purpose, never merged) - this script leaves those
// completely alone. A pair whose two team_key strings canonicalize to the
// SAME team is the bug: scripts/footballdb-import.mjs used to always write
// the raw name, missing whatever scripts/team-key-abbreviate.mjs (or a prior
// ingest run) had already abbreviated in place, and inserting a duplicate
// instead of updating it. lib/footballdb/teamKey.js's canonicalTeamKey() is
// now wired into the ingest before its conflict key is built, so this
// reconciliation is a one-time catch-up, not a permanent fixture.
//
// FOUR STEPS, IN ORDER, EACH PRINTED - see the console output for what each
// one actually did:
//   a. compare every stat column between the two rows of each same-team
//      duplicate pair. ANY drifted pair halts the whole script (nothing
//      written) before b/c/d run at all.
//   b. delete the raw-name sibling of every identical pair, keep the
//      abbreviated one.
//   c. re-key any remaining raw team_key the resolver can now abbreviate
//      (rows never processed by the old team-key-abbreviate.mjs, e.g.
//      2000/2001 - ingested raw this session, never abbreviated).
//   d. print the new table total and per-season counts.
//
// Usage:
//   set -a && . ./.env.local && set +a
//   node scripts/footballdb-teamkey-dedup.mjs             # dry run
//   node scripts/footballdb-teamkey-dedup.mjs --apply       # writes
//   To hit PROD: export DATABASE_URL="$PROD_DATABASE_URL" first.

import crypto from 'node:crypto';
import { sql } from '../lib/db.js';
import { canonicalTeamKey } from '../lib/footballdb/teamKey.js';

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
const resolver = (name) => byName.get(name.toLowerCase()) ?? null;
const canon = (key) => canonicalTeamKey(key, resolver);

const STAT_COLS = [
  'games', 'pass_cmp', 'pass_att', 'pass_yds', 'pass_td', 'pass_int',
  'rush_att', 'rush_yds', 'rush_td', 'rush_long',
  'rec', 'rec_yds', 'rec_td', 'rec_long',
  'fumbles_lost', 'fgm', 'fga', 'fg_long', 'xp',
  'sacks', 'def_int', 'def_td', 'position', 'matched_by', 'raw_name',
];

// ---------------------------------------------------------------------------
// STEP a — find same-team duplicate pairs, compare every stat column.
// ---------------------------------------------------------------------------
const allRows = await sql`SELECT * FROM nfl_player_season_totals WHERE source = 'footballdb'`;
// GROUP BY (player, season, CANONICAL team) - NOT (player, season) alone.
// A traded player has TWO real rows for two DIFFERENT canonical teams
// (migrations/089's own ruling - never merge those); grouping by
// (player, season) alone would lump a trade's two legitimate rows together
// with whatever duplicate each SIDE separately picked up, and then flag
// the whole mess as "drifted" the moment the two real teams' stats
// naturally differ. Caught in the first dry run: e.g. Jeff Moore 1981 has
// FOUR rows - SEA/"Seattle Seahawks" (a real duplicate pair) AND
// LAR/"Los Angeles Rams" (a real duplicate pair from his OTHER, traded-to
// team) - two independent same-team groups, not one four-row group.
const byPlayerSeasonTeam = new Map();
for (const r of allRows) {
  const k = `${r.nfl_player_id}|${r.season_year}|${canon(r.team_key)}`;
  if (!byPlayerSeasonTeam.has(k)) byPlayerSeasonTeam.set(k, []);
  byPlayerSeasonTeam.get(k).push(r);
}

// GROUPS, NOT JUST PAIRS. Same-team duplicates were found in sizes 2-6, not
// only 2 - the corpus has been fully re-ingested more than once across
// separate sessions, and each re-run before canonicalTeamKey() existed could
// add one more raw-named copy. A group of N same-team rows collapses to
// exactly ONE survivor (the abbreviated one if any row already carries it,
// else the lowest id) with the rest deleted - IF every row in the group is
// stat-identical. Any disagreement anywhere in the group halts the script.
const identicalGroups = [];
const driftedGroups = [];
for (const [, group] of byPlayerSeasonTeam) {
  if (group.length < 2) continue; // every row in this group already shares one canonical team

  const survivor = group.find((r) => /^[A-Z]{2,3}$/.test(r.team_key)) ?? [...group].sort((a, b) => a.id - b.id)[0];
  const toDelete = group.filter((r) => r.id !== survivor.id);

  const diffs = new Set();
  for (const r of toDelete) {
    for (const c of STAT_COLS) {
      if (String(survivor[c] ?? '') !== String(r[c] ?? '')) diffs.add(c);
    }
  }
  if (diffs.size) {
    driftedGroups.push({ survivorId: survivor.id, otherIds: toDelete.map((r) => r.id), name: survivor.raw_name, season: survivor.season_year, diffs: [...diffs], group });
  } else {
    identicalGroups.push({ survivorId: survivor.id, deleteIds: toDelete.map((r) => r.id), name: survivor.raw_name, season: survivor.season_year });
  }
}

const totalDeletable = identicalGroups.reduce((n, g) => n + g.deleteIds.length, 0);
console.log(`\nSTEP a — same-team duplicate groups: ${identicalGroups.length + driftedGroups.length}`);
console.log(`  identical (every row in the group matches the survivor on every stat column): ${identicalGroups.length}  (${totalDeletable} rows deletable)`);
console.log(`  drifted (some row differs):                                                    ${driftedGroups.length}`);

if (driftedGroups.length) {
  console.log('\nDRIFTED GROUPS (up to 20) - STOPPING, nothing written:');
  for (const d of driftedGroups.slice(0, 20)) {
    console.log(`   ${d.name} (${d.season}) survivor id=${d.survivorId}, others=${JSON.stringify(d.otherIds)} - differs: ${d.diffs.join(', ')}`);
    for (const r of d.group) console.log(`      id=${r.id} team_key=${r.team_key} ${d.diffs.map((c) => `${c}=${JSON.stringify(r[c])}`).join(' ')}`);
  }
  process.exit(1);
}

// ---------------------------------------------------------------------------
// STEP b — delete every non-survivor row in each identical group.
// ---------------------------------------------------------------------------
console.log(`\nSTEP b — deleting ${totalDeletable} rows across ${identicalGroups.length} identical groups`);
if (apply && totalDeletable) {
  const ids = identicalGroups.flatMap((g) => g.deleteIds);
  await sql`DELETE FROM nfl_player_season_totals WHERE id = ANY(${ids})`;
  console.log(`DELETED ${ids.length} rows.`);
} else {
  console.log(`DRY RUN — would delete ${totalDeletable} rows. Re-run with --apply to write.`);
}

// ---------------------------------------------------------------------------
// STEP c — re-key any remaining raw team_key the resolver can now resolve.
// ---------------------------------------------------------------------------
const remainingRaw = await sql`
  SELECT id, team_key FROM nfl_player_season_totals
  WHERE source = 'footballdb' AND team_key !~ '^[A-Z]{2,3}$'`;
const rekeyable = remainingRaw.filter((r) => canon(r.team_key) !== r.team_key);
console.log(`\nSTEP c — remaining raw team_key rows: ${remainingRaw.length}, resolver can now abbreviate: ${rekeyable.length}`);
if (apply && rekeyable.length) {
  for (const r of rekeyable) {
    await sql`UPDATE nfl_player_season_totals SET team_key = ${canon(r.team_key)} WHERE id = ${r.id}`;
  }
  console.log(`WROTE ${rekeyable.length} re-key updates.`);
} else if (rekeyable.length) {
  console.log(`DRY RUN — would re-key ${rekeyable.length} rows. Re-run with --apply to write.`);
}

if (apply) {
  const stillDupes = await sql`
    SELECT nfl_player_id, season_year, count(*) FROM nfl_player_season_totals
    WHERE source = 'footballdb' GROUP BY nfl_player_id, season_year, team_key
    HAVING count(*) > 1`;
  console.log(`\nconfirm zero same-key-exact-duplicate rows remain (exact (player,season,team_key) triples): ${stillDupes.length}`);
}

// ---------------------------------------------------------------------------
// STEP d — new totals.
// ---------------------------------------------------------------------------
const [{ total }] = await sql`SELECT count(*) AS total FROM nfl_player_season_totals`;
console.log(`\nSTEP d — new table total (all sources): ${total}`);
const perSeason = await sql`
  SELECT season_year, count(*) AS n FROM nfl_player_season_totals
  WHERE season_year IN (1995, 1999, 2000, 2001) GROUP BY 1 ORDER BY 1`;
console.table(perSeason);
