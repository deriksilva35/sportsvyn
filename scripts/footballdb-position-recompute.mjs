#!/usr/bin/env node
// scripts/footballdb-position-recompute.mjs — recompute
// nfl_player_season_totals.position for every footballdb row, under the
// CURRENT lib/daily/inferPosition.js law (migrations/093).
//
// WHY THIS SCRIPT EXISTS AT ALL. The served path
// (app/daily/board/page.js, lib/daily/seasonBoardEditions.js) reads the
// stored position column directly and never recomputes it at read time -
// confirmed this relay. Every position-inference law change so far (the
// magnitude-and-attempts-floor fix, then the touches amendment) only changed
// what a FUTURE footballdb ingest writes; neither one retroactively touched
// a row already sitting in the table. This script is that retroactive pass.
//
// SCOPE (widened, migrations/094): source='footballdb' AND (the matched
// player has bdl_player_id IS NULL, OR the matched player's OWN position is
// UNK/null/empty) - not "every footballdb row," and not matched_by. A REAL
// stored position (on a bdl_player_id NOT NULL row, whether a skill position
// or a non-skill one like DE/CB/G) is ground truth and is NEVER recomputed.
//
//   1. resolveIdentity()'s 'exact' outcome always inherits the MATCHED
//      PLAYER'S OWN nfl_players.position (never re-infers) - confirmed live:
//      Harvey Williams (nfl_players.id=39231, bdl_player_id NULL) shows
//      position='QB' on EVERY ONE of his 11 stored season rows, uniformly -
//      it is a per-PLAYER value inherited at write time, not a per-season
//      computation, for any row matched_by='exact'.
//   2. matched_by ITSELF DOES NOT DISTINGUISH "real BDL position" FROM
//      "originally inferred, now stale" - every footballdb-only player this
//      corpus ever CREATED has, by now, been re-ingested at least once since
//      creation, and each re-match OVERWRITES matched_by from 'created' to
//      'exact'. Only bdl_player_id still tells the two cases apart.
//   3. A "real BDL player" is not always a real POSITION (094's own
//      finding): BDL can carry bdl_player_id for a RETIRED player it knows
//      existed but never tracked a position for - Jerry Rice, on DEV,
//      showed position='UNK' with bdl_player_id=22049 present, silently
//      excluding him from BOARD_POSITIONS on every one of his 17 seasons
//      since the corpus existed. UNK/null/empty are not positions, so a
//      row inheriting one is treated exactly like an unmatched row -
//      inferred from its own stats under the current law, same as any
//      footballdb-only identity.
//
// NOT IN SCOPE, ON PURPOSE (094's own header): a footballdb row whose
// matched player carries a REAL non-skill position (DE, CB, G, LS, ...) -
// an offensive stat line on a lineman/defender is very likely a WRONG
// identity, not a stale position - the identity-resolution law leaking
// through 'exact', not something this recompute is built to fix. Left
// alone here; measured and reported for a later relay.
//
// Usage:
//   set -a && . ./.env.local && set +a
//   node scripts/footballdb-position-recompute.mjs             # dry run
//   node scripts/footballdb-position-recompute.mjs --apply       # writes
//   To hit PROD: export DATABASE_URL="$PROD_DATABASE_URL" first.

import crypto from 'node:crypto';
import { sql } from '../lib/db.js';
import { inferPosition } from '../lib/daily/inferPosition.js';

const apply = process.argv.includes('--apply');

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set.'); process.exit(1); }
const fingerprint = crypto.createHash('sha256').update(String(process.env.DATABASE_URL)).digest('hex').slice(0, 12);
console.log('='.repeat(74));
console.log(`TARGET   DATABASE_URL -> ${new URL(process.env.DATABASE_URL).host}`);
console.log(`FINGERPRINT   ${fingerprint}`);
console.log(`WRITES   ${apply ? 'YES — --apply given' : 'NO — dry run'}`);
console.log('='.repeat(74));

// ---------------------------------------------------------------------------
// STEP 1 — DELETE ROWS WITH NO PRODUCTION IN ANY READ CATEGORY (ruling).
// passAtt, rushAtt, rec, fga all zero or null - nothing this ingest reads
// happened on the row at all. These are not season lines - a formal 0-for-0
// Passing-tab entry for a punter, a Kicking-tab row for a kicker who never
// attempted a field goal that year, and the like - they exist only because
// an OLDER, broken position law gave them a skill position they never
// qualified for under any law since. THE ONLY DELETION 093 PERFORMS. Nothing
// with any nonzero tracked stat is ever deleted - a row with real production
// always survives, even if its position changes.
// ---------------------------------------------------------------------------
const forDeleteCheck = await sql`
  SELECT t.id, t.raw_name, t.season_year, t.team_key
    FROM nfl_player_season_totals t
    JOIN nfl_players p ON p.id = t.nfl_player_id
   WHERE t.source = 'footballdb'
     AND (p.bdl_player_id IS NULL OR p.position IS NULL OR p.position IN ('UNK', ''))
     AND COALESCE(t.pass_att, 0) = 0 AND COALESCE(t.rush_att, 0) = 0
     AND COALESCE(t.rec, 0) = 0 AND COALESCE(t.fga, 0) = 0`;

console.log(`\nSTEP 1 — empty rows (no production in passAtt/rushAtt/rec/fga): ${forDeleteCheck.length}`);
if (forDeleteCheck.length) {
  console.table(forDeleteCheck.map((r) => ({ id: r.id, name: r.raw_name, season: r.season_year, team: r.team_key })));
}

if (apply && forDeleteCheck.length) {
  const ids = forDeleteCheck.map((r) => r.id);
  await sql`DELETE FROM nfl_player_season_totals WHERE id = ANY(${ids})`;
  console.log(`DELETED ${ids.length} empty rows.`);
} else if (forDeleteCheck.length) {
  console.log('DRY RUN — no delete performed. Re-run with --apply to delete + recompute.');
}

// ---------------------------------------------------------------------------
// STEP 2 — RECOMPUTE POSITION under the current inferPosition() law for
// every row still standing (source=footballdb, bdl_player_id IS NULL OR the
// matched player's own position is UNK/null/empty).
// ---------------------------------------------------------------------------
const rows = await sql`
  SELECT t.id, t.position, t.pass_att, t.pass_yds, t.pass_td, t.pass_int,
         t.rush_att, t.rush_yds, t.rush_td, t.rec, t.rec_yds, t.rec_td, t.fgm, t.fga
    FROM nfl_player_season_totals t
    JOIN nfl_players p ON p.id = t.nfl_player_id
   WHERE t.source = 'footballdb'
     AND (p.bdl_player_id IS NULL OR p.position IS NULL OR p.position IN ('UNK', ''))`;

const before = {};
const after = {};
const changes = [];
for (const r of rows) {
  before[r.position ?? 'null'] = (before[r.position ?? 'null'] ?? 0) + 1;
  const newPosition = inferPosition({
    passAtt: r.pass_att, passYds: r.pass_yds, passTd: r.pass_td, passInt: r.pass_int,
    rushAtt: r.rush_att, rushYds: r.rush_yds, rushTd: r.rush_td,
    rec: r.rec, recYds: r.rec_yds, recTd: r.rec_td,
    fgm: r.fgm, fga: r.fga,
  });
  after[newPosition ?? 'null'] = (after[newPosition ?? 'null'] ?? 0) + 1;
  if (newPosition !== r.position) changes.push({ id: r.id, from: r.position, to: newPosition });
}

console.log(`\nrows examined (source=footballdb): ${rows.length}`);
console.log('\nBEFORE (stored position):', before);
console.log('AFTER  (recomputed, touches law):', after);
console.log(`\nrows whose position changes: ${changes.length}`);

if (apply && changes.length) {
  for (const c of changes) {
    await sql`UPDATE nfl_player_season_totals SET position = ${c.to} WHERE id = ${c.id}`;
  }
  console.log(`\nWROTE ${changes.length} position updates.`);
} else {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to write.');
}
