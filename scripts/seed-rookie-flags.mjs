// scripts/seed-rookie-flags.mjs — set nfl_players.rookie_season for the 2026
// rookie class present in the ADP pool.
//
//   node scripts/seed-rookie-flags.mjs                 dry run (default)
//   APPLY=1 node scripts/seed-rookie-flags.mjs         write to DEV
//   TARGET=prod APPLY=1 node scripts/seed-rookie-flags.mjs   write to PROD
//
// ======================= WHERE THIS LIST CAME FROM ==========================
// TWO INDEPENDENT SOURCES, agreeing exactly. Not memory, and not the mocks.
//
//   1. BDL's `experience` field, read for all 231 non-defense players across ALL
//      FOUR format pools in the 2026-08-04 snapshot. Every one resolved.
//      19 read "Rookie".
//   2. Derik's fantasy-platform rookie list (181 names marked (R)).
//
// The overlap is 19 and 19. ZERO disagreements in either direction - no player
// is (R) on the platform but non-rookie in BDL, and none the reverse.
//
// TWO WRONG LISTS WERE REJECTED ALONG THE WAY, which is why the corroboration
// matters:
//   · The MOCKS say "rookie flags illustrative" and mean it - Hampton, Hunter,
//     McMillan, Egbuka, Judkins, Loveland, Skattebo, Sampson, Tuten and Jeanty
//     all read "2nd Season" in BDL. They are the 2025 class.
//   · A first platform export was LAST SEASON'S rookies (Shough, Sanders,
//     Loveland, Gadsden, TeSlaa, Blue, Horton, Jordan James). Cross-checking it
//     produced nine disagreements, every one of which BDL called "2nd Season".
//     That disagreement set is exactly what flagged the export as wrong.
// Either list, seeded on trust, would have put second-year players under an R
// chip on a published board.
//
// Transcribed here BY HAND as a frozen record of 2026-08-04, because migration
// 057's whole point is that the flag is STORED rather than derived - a script
// that re-parsed `experience` at runtime would be the derivation we are
// deliberately avoiding until the string's shape is understood across a season.
//
// CAVEAT, recorded rather than resolved: the 181 platform names were transcribed
// from chat pastes, not imported from a file. The reconciliation came back clean
// in BOTH directions across all 181, which is strong evidence the transcription
// is faithful - a mistyped name would almost certainly have surfaced as a
// phantom disagreement, and none did. Accepted on that basis; noted here so a
// future reader knows the provenance is a transcription, not an export.
//
// DISTINCT `experience` VALUES SEEN (logged per the brief, not parsed):
//   Rookie 18 · 1st Season 1 · 2nd Season 32 · 3rd Season 26 · 4th Season 33
//   5th Season 31 · 6th Season 14 · 7th Season 16 · 8th Season 14 · 9th Season 12
//   10th 10 · 11th 7 · 12th 2 · 13th 3 · 14th 1 · 18th 1 · 19th 1 · (null) 1
// Note BOTH "Rookie" AND "1st Season" occur, for players of different ages -
// which is exactly why nothing parses this yet.
//
// MATCHING is on normalized name + position, never on name alone: the pool has
// distinct players who share a surname (Jalen McMillan / Tetairoa McMillan,
// Hunter Henry / Travis Hunter), and a name-only match would flag the wrong one.

import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const s = line.trim(); if (!s || s.startsWith('#')) continue;
  const eq = s.indexOf('='); if (eq < 0) continue;
  const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
  if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

export const ROOKIE_SEASON = 2026;

// Observed BDL experience === "Rookie" on 2026-08-04, ppr/12 pool.
// name, position, team are as the pool carries them.
export const ROOKIES_2026 = [
  { name: 'Antonio Williams',    position: 'WR', team: 'WAS', college: 'Clemson' },
  { name: 'Carnell Tate',        position: 'WR', team: 'TEN', college: 'Ohio State' },
  // 2qb/12 only - a QB2 in a superflex pool, which is why he sat outside the
  // platform's top-100 export and only surfaced once the sweep covered all four
  // format pools rather than ppr/12 alone.
  { name: 'Carson Beck',         position: 'QB', team: 'ARI', college: 'Miami' },
  { name: "De'Zhaun Stribling",  position: 'WR', team: 'SF',  college: 'Ole Miss' },
  { name: 'Demond Claiborne',    position: 'RB', team: 'MIN', college: 'Wake Forest' },
  { name: 'Denzel Boston',       position: 'WR', team: 'CLE', college: 'Washington' },
  { name: 'Fernando Mendoza',    position: 'QB', team: 'LV',  college: 'Indiana' },
  { name: 'Germie Bernard',      position: 'WR', team: 'PIT', college: 'Alabama' },
  { name: 'Jadarian Price',      position: 'RB', team: 'SEA', college: 'Notre Dame' },
  { name: 'Jeremiyah Love',      position: 'RB', team: 'ARI', college: 'Notre Dame' },
  { name: 'Jonah Coleman',       position: 'RB', team: 'DEN', college: 'Washington' },
  { name: 'Jordyn Tyson',        position: 'WR', team: 'NO',  college: 'Arizona State' },
  { name: 'Kaelon Black',        position: 'RB', team: 'SF',  college: 'Indiana' },
  { name: 'KC Concepcion',       position: 'WR', team: 'CLE', college: 'Texas A&M' },
  { name: 'Kenyon Sadiq',        position: 'TE', team: 'NYJ', college: 'Oregon' },
  { name: 'Makai Lemon',         position: 'WR', team: 'PHI', college: 'USC' },
  { name: 'Mike Washington Jr.', position: 'RB', team: 'LV',  college: 'Arkansas' },
  { name: 'Omar Cooper Jr.',     position: 'WR', team: 'NYJ', college: 'Indiana' },
  { name: 'Zachariah Branch',    position: 'WR', team: 'ATL', college: 'Georgia' },
];

// NOT SEEDED. Empty because the cross-check resolved the one open case.
//
// Theo Wease Jr. (WR, MIA) was held here: BDL reads "1st Season" rather than
// "Rookie", he is 25, and he is the only player in any pool with that string.
// He is ALSO absent from the platform's rookie list. Both sources decline to
// call him a rookie, so he is simply not one - a first ACTIVE season after a
// practice-squad year is not a rookie season. Resolved by agreement, not by a
// judgement call.
export const UNSURE = [];

// The repo's CANONICAL normalizer, imported rather than reimplemented. It is the
// same function that produced nfl_players.normalized_name in the first place, so
// matching against that column is consistent by construction.
//
// My first version hand-rolled this and kept the generational suffix, so
// "Mike Washington Jr." normalized to "mike washington jr" and missed the row
// stored as "mike washington". Two of eighteen rookies silently failed to match -
// which is exactly the class of bug that produces a board with a couple of
// missing R chips and no error anywhere.
export { normalizeName } from '../lib/gridiron/nameMatch.js';
import { normalizeName } from '../lib/gridiron/nameMatch.js';

const APPLY = process.env.APPLY === '1';
const TARGET = (process.env.TARGET ?? 'dev').toLowerCase();

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = TARGET === 'prod' ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) { console.error(`no connection string for TARGET=${TARGET}`); process.exit(1); }
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);

  console.log(`TARGET: ${TARGET.toUpperCase()}   MODE: ${APPLY ? '*** APPLY (WILL WRITE) ***' : 'DRY RUN (no writes)'}`);
  console.log(`DB: ${(await sql`SELECT current_database() d`)[0].d}\n`);

  const has = await sql`SELECT 1 FROM information_schema.columns WHERE table_name='nfl_players' AND column_name='rookie_season'`;
  if (!has.length) { console.error('nfl_players.rookie_season does not exist - migration 057 has not been applied here.'); process.exit(2); }

  const candidates = await sql`
    SELECT id, full_name, normalized_name, position, is_team_defense FROM nfl_players WHERE is_team_defense = false`;
  const byKey = new Map();
  for (const r of candidates) byKey.set(`${r.normalized_name}|${r.position}`, r);

  const matched = [];
  const missed = [];
  for (const r of ROOKIES_2026) {
    const hit = byKey.get(`${normalizeName(r.name)}|${r.position}`);
    if (hit) matched.push({ ...r, id: hit.id, dbName: hit.full_name });
    else missed.push(r);
  }

  console.log(`MATCHED ${matched.length} / ${ROOKIES_2026.length}`);
  for (const m of matched) console.log(`  id=${String(m.id).padEnd(7)} ${m.dbName.padEnd(24)} ${m.position} ${m.team}`);
  if (missed.length) {
    console.log(`\nNOT MATCHED in nfl_players (${missed.length}) - these would be skipped:`);
    for (const m of missed) console.log(`  ${m.name.padEnd(24)} ${m.position} ${m.team}`);
  }
  console.log(`\nHELD BACK AS UNSURE (never written): ${UNSURE.length}`);
  for (const u of UNSURE) console.log(`  ${u.name} ${u.position} ${u.team} - ${u.why.split(' - ')[0]}`);

  if (!APPLY) {
    console.log(`\nDRY RUN - nothing written. Would set rookie_season=${ROOKIE_SEASON} on ${matched.length} rows.`);
  } else {
    const ids = matched.map((m) => m.id);
    const r = await sql`UPDATE nfl_players SET rookie_season = ${ROOKIE_SEASON}, updated_at = now()
                         WHERE id = ANY(${ids}::int[]) RETURNING id`;
    console.log(`\nWROTE rookie_season=${ROOKIE_SEASON} to ${r.length} rows.`);
  }

  const now = await sql`SELECT rookie_season, count(*)::int c FROM nfl_players GROUP BY rookie_season ORDER BY rookie_season NULLS LAST`;
  console.log('\nrookie_season distribution:');
  for (const row of now) console.log(`  ${row.rookie_season ?? 'NULL'}: ${row.c}`);
}
