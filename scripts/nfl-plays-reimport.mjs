#!/usr/bin/env node
// scripts/nfl-plays-reimport.mjs - re-derive a season's NFL plays from BDL with
// the current normaliser: whose ball each row is (offense_team_id), the drive
// each row sits in (drive_id / drive_number / play_number), the drive
// envelopes (matches.metadata.drives) and the feed's end-of-play state
// (end_down / end_distance / end_yards_to_goal, migration 123).
//
// WHY A RE-FETCH. plays keeps no raw payload - only the normalised columns -
// and the corrections need what normalisation threw away (BDL's `team`, and
// its end_* fields). So each game is fetched again: one request per 100 plays,
// about two per game (103 for the 49 finals of 2026 weeks 1-4, 2 Oct).
//
// WHAT CHANGES (relay fri-4 a/b). The handoff list missed the slugs BDL
// actually sends for an interception, a missed field goal and a strip-sack
// the defence keeps, and had no rule for a turnover on downs; on all four the
// row's `team` is the side that ENDS UP with the ball while its down, distance
// and spot are the old offense's. See lib/gridiron/plays.js HANDOFF_TYPES and
// isTurnoverOnDowns.
//
// Belongs in scripts/ because it will run again: after any further change to
// the normaliser, a season's stored plays must be brought level with it.
//
// CREDENTIALS FROM THE ENVIRONMENT ONLY:
//   set -a && . ./.env.local && set +a
//   node scripts/nfl-plays-reimport.mjs                     # DEV, dry run
//   node scripts/nfl-plays-reimport.mjs --prod              # PROD, dry run
//   node scripts/nfl-plays-reimport.mjs --prod --apply      # PROD, write
//   ... [--season 2026] [--slug <match-slug> ...]
// Only FINAL games are touched: a live game is re-read by plays-live every
// minute and would race the write.
//
// EVERY IMPORT IS DYNAMIC (see scripts/plays-backfill.mjs): lib/db.js freezes
// DATABASE_URL when it is first evaluated, so --prod is settled first.

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valuesOf = (flag) => args.reduce((acc, a, i) => (args[i - 1] === flag ? [...acc, a] : acc), []);

const wantProd = has('--prod');
const apply = has('--apply');
if (wantProd) {
  if (!process.env.PROD_DATABASE_URL) { console.error('--prod given but PROD_DATABASE_URL is not set'); process.exit(1); }
  process.env.DATABASE_URL = process.env.PROD_DATABASE_URL;
}
const season = Number(valuesOf('--season')[0] ?? 2026);
const slugs = valuesOf('--slug');

const { sql } = await import('../lib/db.js');
const { fetchBdlPlays, teamMapFor, nflPlaysAndDrives, writePlays, writeDriveEnvelopes } = await import('../lib/gridiron/playsImport.js');
const { diffGame, applyGame, SHOWCASE } = await import('../lib/gridiron/playsReimport.js');

if (wantProd && process.env.DATABASE_URL !== process.env.PROD_DATABASE_URL) {
  console.error('refusing: --prod given but DATABASE_URL is not PROD_DATABASE_URL'); process.exit(1);
}
const target = wantProd ? 'PROD' : 'dev';

// MIGRATION 123 FIRST. A dry run works without it (the end-of-play columns
// read as absent); --apply refuses, because the write and the live importer
// both need them.
const [col] = await sql`
  SELECT count(*)::int n FROM information_schema.columns
   WHERE table_name = 'plays' AND column_name IN ('end_down', 'end_distance', 'end_yards_to_goal')`;
const hasEnd = col.n === 3;
if (!hasEnd) {
  if (apply) { console.error(`refusing: plays has no end_down/end_distance/end_yards_to_goal on ${target} - apply migrations/123_plays_end_state.sql first`); process.exit(1); }
  console.log(`NOTE: migration 123 is not applied on ${target}; end-of-play columns read as empty`);
}

const games = await sql`
  SELECT m.id, m.slug, m.league_id, m.status, m.external_ids->>'bdl_game_id' AS bdl_game_id,
         m.metadata->'drives' AS drives
    FROM matches m JOIN leagues l ON l.id = m.league_id
   WHERE l.slug = 'nfl' AND m.season_year = ${season} AND m.status = 'final'
     AND m.external_ids ? 'bdl_game_id'
     AND EXISTS (SELECT 1 FROM plays p WHERE p.match_id = m.id)
     ${slugs.length ? sql`AND m.slug = ANY(${slugs})` : sql``}
   ORDER BY m.kickoff_at, m.id`;
console.log(`nfl-plays-reimport -> ${target}, season ${season}, ${games.length} final game(s), ${apply ? 'APPLY' : 'dry run'}`);

const total = { requests: 0, feedRows: 0, stored: 0, offenseByType: {}, driveMoved: 0, endFilled: 0, missing: 0, envelopesChanged: 0, games: 0, failed: 0, written: 0, inserted: 0 };
let tmap = null;
for (const g of games) {
  try {
    tmap ??= await teamMapFor(g.league_id, 'bdl_team_id');
    const { rows, pages } = await fetchBdlPlays(g.bdl_game_id);
    total.requests += pages; total.feedRows += rows.length;
    const { plays, drives } = nflPlaysAndDrives(rows, tmap);
    // One game's rows at a time (~180): never the season in memory.
    const stored = await sql`
      SELECT id, provider_play_id, drive_id, drive_number, play_number, offense_team_id, play_type,
             ${hasEnd ? sql`end_down, end_distance, end_yards_to_goal` : sql`NULL::int AS end_down, NULL::int AS end_distance, NULL::int AS end_yards_to_goal`}
        FROM plays WHERE match_id = ${g.id}`;
    const d = diffGame(stored, plays, g.drives, drives);
    total.stored += stored.length; total.driveMoved += d.driveMoved; total.endFilled += d.endFilled;
    total.missing += d.missing.length; total.envelopesChanged += d.envelopesChanged ? 1 : 0; total.games++;
    for (const [t, n] of Object.entries(d.offenseByType)) total.offenseByType[t] = (total.offenseByType[t] ?? 0) + n;

    const show = SHOWCASE[g.slug];
    if (show) {
      const s = stored.find((r) => r.provider_play_id === show.providerPlayId);
      const n = plays.find((p) => p.providerPlayId === show.providerPlayId);
      const envOf = (list, driveId) => (Array.isArray(list) ? list : []).find((e) => e.driveId === driveId) ?? null;
      const fmtEnv = (e) => (e ? `${e.driveId} ${e.offenseName} plays=${e.playCount} yds=${e.yards} result=${e.result}` : '-');
      console.log(`\n  ${show.label} (${g.slug}, play ${show.providerPlayId})`);
      console.log(`    BEFORE offense_team_id=${s?.offense_team_id} drive=${s?.drive_id}#${s?.play_number} end=${s?.end_down ?? '-'}/${s?.end_distance ?? '-'}/${s?.end_yards_to_goal ?? '-'}`);
      console.log(`    AFTER  offense_team_id=${n?.offenseTeamId} drive=${n?.driveId}#${n?.playNumber} end=${n?.endDown}/${n?.endDistance}/${n?.endYardsToGoal}`);
      console.log(`    drive BEFORE: ${fmtEnv(envOf(g.drives, s?.drive_id))}   (and the one before it: ${fmtEnv(envOf(g.drives, `r${(s?.drive_number ?? 0) - 1}`))})`);
      console.log(`    drive AFTER:  ${fmtEnv(envOf(drives, n?.driveId))}   (and the one after it: ${fmtEnv(envOf(drives, `r${(n?.driveNumber ?? 0) + 1}`))})\n`);
    }

    if (apply) {
      const w = await applyGame(sql, g.id, plays, d);
      total.written += w.updated;
      if (d.missing.length) total.inserted += await writePlays(g.id, d.missing);
      await writeDriveEnvelopes(g.id, drives);
    }
  } catch (e) {
    total.failed++;
    console.error(`  FAIL  ${g.slug}: ${e.message}`);
  }
}

console.log(`\n== ${target} summary (${apply ? 'APPLIED' : 'DRY RUN - nothing written'}) ==`);
console.log(`games ${total.games}/${games.length} (failed ${total.failed}), BDL requests ${total.requests}, feed rows ${total.feedRows}, stored rows ${total.stored}`);
const byType = Object.entries(total.offenseByType).sort((a, b) => b[1] - a[1]);
console.log(`offense_team_id would change on ${byType.reduce((s, [, n]) => s + n, 0)} row(s), by play type:`);
for (const [t, n] of byType) console.log(`  ${String(n).padStart(5)}  ${t}`);
console.log(`drive_id/drive_number/play_number would change on ${total.driveMoved} row(s)`);
console.log(`end-of-play state would be filled/changed on ${total.endFilled} row(s)`);
console.log(`rows in the feed but not stored: ${total.missing}${apply ? ` (inserted ${total.inserted})` : ''}`);
console.log(`drive envelopes that change: ${total.envelopesChanged} game(s)`);
if (apply) {
  console.log(`rows updated: ${total.written}`);
  // READ BACK THROUGH THE SAME CONNECTION (scripts/plays-backfill.mjs's lesson).
  const [back] = await sql`
    SELECT count(*)::int n, count(*) FILTER (WHERE p.end_down IS NOT NULL)::int with_end
      FROM plays p JOIN matches m ON m.id = p.match_id JOIN leagues l ON l.id = m.league_id
     WHERE l.slug = 'nfl' AND m.season_year = ${season}`;
  console.log(`read-back on ${target}: ${back.n} ${season} NFL plays, ${back.with_end} with an end-of-play state`);
}
if (total.failed) process.exitCode = 1;
