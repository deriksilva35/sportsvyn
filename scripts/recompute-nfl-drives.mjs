#!/usr/bin/env node
// scripts/recompute-nfl-drives.mjs - bring a season's stored NFL drive envelopes
// (matches.metadata.drives) level with lib/gridiron/plays.js driveYardsFor (drive-4):
// the yards of a drive that ended on a MADE FIELD GOAL run to the kick's line, not to
// the goal line or to an arbitrary BDL end spot (CLE@NO r12 stored 63, true 54).
//
// FROM THE STORED PLAYS, NO BDL FETCH: the kick row's yards_to_goal is the line it was
// taken from. Only envelope.yards of Field-goal drives can change (see
// lib/gridiron/recomputeDrives.js for why nothing else depends on the fix).
//
// CREDENTIALS FROM THE ENVIRONMENT ONLY:
//   set -a && . ./.env.local && set +a
//   node scripts/recompute-nfl-drives.mjs                      # DEV, dry run
//   node scripts/recompute-nfl-drives.mjs --prod               # PROD, dry run (SELECT only)
//   node scripts/recompute-nfl-drives.mjs --prod --apply       # PROD, write
//   ... [--season 2026] [--slug <match-slug> ...] [--undo <file.jsonl>]
// DRY RUN BY DEFAULT: prints per-game counts, the total and a few old -> new samples.
// --apply writes one UPDATE per changed game (streaming: one game's ~200 plays in
// memory at a time, never the season) and first appends the OLD envelopes of that game
// to an undo JSONL ({matchId, slug, drives}); restoring a line is writeDriveEnvelopes
// (matchId, drives). IDEMPOTENT: a second run finds nothing to change. Final games only
// (a live game is re-read by the poller and would race the write).

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

// DYNAMIC IMPORTS: lib/db.js freezes DATABASE_URL when first evaluated (see nfl-plays-reimport.mjs).
const { sql } = await import('../lib/db.js');
const { recomputeEnvelopes } = await import('../lib/gridiron/recomputeDrives.js');
const { writeDriveEnvelopes } = await import('../lib/gridiron/playsImport.js');
const fs = await import('node:fs');

if (wantProd && process.env.DATABASE_URL !== process.env.PROD_DATABASE_URL) {
  console.error('refusing: --prod given but DATABASE_URL is not PROD_DATABASE_URL'); process.exit(1);
}
const target = wantProd ? 'PROD' : 'dev';
const undoFile = valuesOf('--undo')[0] ?? `test-tmp/undo-recompute-nfl-drives-${target}-${Date.now()}.jsonl`;

const games = await sql`
  SELECT m.id, m.slug FROM matches m JOIN leagues l ON l.id = m.league_id
   WHERE l.slug = 'nfl' AND m.season_year = ${season} AND m.status = 'final'
     AND jsonb_typeof(m.metadata->'drives') = 'array'
     ${slugs.length ? sql`AND m.slug = ANY(${slugs})` : sql``}
   ORDER BY m.kickoff_at, m.id`;
console.log(`recompute-nfl-drives -> ${target}, season ${season}, ${games.length} final game(s), ${apply ? 'APPLY' : 'dry run'}`);

const total = { games: 0, gamesChanged: 0, drivesChanged: 0, fgDrives: 0, written: 0 };
const samples = [];
if (apply) fs.mkdirSync(undoFile.includes('/') ? undoFile.slice(0, undoFile.lastIndexOf('/')) : '.', { recursive: true });
for (const g of games) {
  const [m] = await sql`SELECT metadata->'drives' AS drives FROM matches WHERE id = ${g.id}`;
  const plays = await sql`SELECT drive_id, play_type, play_number, yards_to_goal FROM plays WHERE match_id = ${g.id} AND play_type = 'field-goal-good'`;
  const { drives, changes } = recomputeEnvelopes(m.drives, plays);
  total.games++;
  total.fgDrives += (m.drives ?? []).filter((e) => e?.result === 'Field goal').length;
  if (!changes.length) continue;
  total.gamesChanged++; total.drivesChanged += changes.length;
  console.log(`  ${g.slug}: ${changes.length} drive(s) ${changes.map((c) => `${c.driveId} ${c.old}->${c.new}`).join(', ')}`);
  for (const c of changes) if (samples.length < 6) samples.push(`${g.slug} ${c.driveId}: ${c.old} -> ${c.new}`);
  if (apply) {
    fs.appendFileSync(undoFile, `${JSON.stringify({ matchId: g.id, slug: g.slug, drives: m.drives })}\n`);
    await writeDriveEnvelopes(g.id, drives);
    total.written++;
  }
}
console.log(`\n== ${target} summary (${apply ? 'APPLIED' : 'DRY RUN - nothing written'}) ==`);
console.log(`games scanned ${total.games}, Field-goal drives ${total.fgDrives}`);
console.log(`drive envelopes that change: ${total.drivesChanged} in ${total.gamesChanged} game(s)`);
if (samples.length) console.log(`samples (old -> new yards):\n  ${samples.join('\n  ')}`);
if (apply) {
  console.log(`games written: ${total.written}; undo: ${undoFile}`);
  const again = []; // idempotence read-back, same connection
  for (const g of games) {
    const [m] = await sql`SELECT metadata->'drives' AS drives FROM matches WHERE id = ${g.id}`;
    const p = await sql`SELECT drive_id, play_type, play_number, yards_to_goal FROM plays WHERE match_id = ${g.id} AND play_type = 'field-goal-good'`;
    if (recomputeEnvelopes(m.drives, p).changes.length) again.push(g.slug);
  }
  console.log(`read-back on ${target}: ${again.length} game(s) still to change${again.length ? ` (${again.join(', ')})` : ''}`);
}
