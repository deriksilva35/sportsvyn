// scripts/nfl-historical-backfill.mjs - backfill ONE past NFL season into
// matches + nfl_player_game_stats from balldontlie.
//
// Reuses the live ingest path rather than duplicating it: syncNflGames() and
// syncNflSeason() were already season-parameterised, so nothing in lib/ changes
// to reach 2015. That is the point. A parallel historical importer would drift
// from the one the season runs on, and the first symptom would be a puzzle that
// scores a 2016 line differently from a 2025 one.
//
// TWO STAGES, ORDERED, NOT OPTIONAL. nfl_player_game_stats.match_id is a FK to
// matches, so a stat row cannot exist before its game does. Stage 2 refuses to
// run when stage 1 has left no matches for the season - it would otherwise
// "succeed" while skipping every row as no-match-game.
//
// ONE SEASON PER INVOCATION. syncNflSeason accumulates the whole season's stat
// rows in memory before writing (~17k rows). That is fine once and not fine ten
// times in one process, so the loop over seasons belongs in the shell.
//
// TARGET DATABASE. Writes go wherever lib/db.js points, which is DATABASE_URL
// and nothing else - there is no --prod flag and no connection string in this
// file. To run against production you must deliberately export a different
// DATABASE_URL, and the fingerprint printed at startup will change when you do.
// Source with `set -a && . ./.env.local && set +a`.
//
// Usage:
//   node scripts/nfl-historical-backfill.mjs 2015
//   node scripts/nfl-historical-backfill.mjs 2015 --stage=games
//   node scripts/nfl-historical-backfill.mjs 2015 --stage=stats

import crypto from 'node:crypto';
import { sql } from '../lib/db.js';
import { syncNflGames } from '../lib/gridiron/sync.js';
import { syncNflSeason } from '../lib/gridiron/nflStatsSync.js';

const args = process.argv.slice(2);
const season = Number(args.find((a) => /^\d{4}$/.test(a)));
const stage = (args.find((a) => a.startsWith('--stage='))?.split('=')[1] ?? 'all').toLowerCase();

// FLOOR IS 2002, MEASURED. balldontlie's own /nfl/v1/stats returns real rows back
// to 2002 (probed live: 1990/1995/1999/2000/2001 come back empty, 2002 does not);
// this used to read `< 2010`, a stale bound from before that probe, and it refused
// 2002-2009 outright rather than reporting a source limit that wasn't real.
if (!Number.isInteger(season) || season < 2002 || season > 2030) {
  console.error('usage: node scripts/nfl-historical-backfill.mjs <season> [--stage=games|stats|all]');
  process.exit(1);
}
if (!['all', 'games', 'stats'].includes(stage)) {
  console.error(`unknown --stage='${stage}' (expected games | stats | all)`);
  process.exit(1);
}

// Identify the target database without printing any part of the credential.
const fingerprint = crypto.createHash('sha256').update(String(process.env.DATABASE_URL)).digest('hex').slice(0, 12);
const log = (m) => console.log(m);
const t0 = Date.now();

async function seasonCounts(leagueId) {
  const m = (await sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE season_phase = 'REG')::int AS reg,
           count(*) FILTER (WHERE season_phase = 'POST')::int AS post
      FROM matches WHERE league_id = ${leagueId} AND season_year = ${season}`)[0];
  const s = (await sql`
    SELECT count(*)::int AS rows, count(DISTINCT s.nfl_player_id)::int AS players
      FROM nfl_player_game_stats s JOIN matches m ON m.id = s.match_id
     WHERE m.league_id = ${leagueId} AND m.season_year = ${season}`)[0];
  const p = (await sql`SELECT count(*)::int AS n FROM nfl_players`)[0];
  return { matches: m.total, reg: m.reg, post: m.post, statRows: s.rows, statPlayers: s.players, playersTable: p.n };
}

const league = (await sql`SELECT id FROM leagues WHERE slug = 'nfl' LIMIT 1`)[0];
if (!league) throw new Error("no league row for 'nfl'");

log(`nfl-historical-backfill  season=${season}  stage=${stage}`);
log(`  target DATABASE_URL fingerprint: ${fingerprint}  (league_id=${league.id})`);
const before = await seasonCounts(league.id);
log(`  before: matches=${before.matches} (REG ${before.reg} / POST ${before.post})  statRows=${before.statRows}  nfl_players=${before.playersTable}`);

const report = { season, stage, fingerprint, before };

// ---- STAGE 1: matches ------------------------------------------------------
if (stage === 'all' || stage === 'games') {
  log('');
  log('STAGE 1  matches  (BDL /nfl/v1/games)');
  const r = await syncNflGames(league.id, season);
  report.games = r;
  log(`  ingested=${r.ingested}  missingTeam=${r.missingTeam}  unknownStatus=${r.unknownStatus}` +
      `  skippedByPhase=${JSON.stringify(r.skippedByPhase)}  timeResolvedFromFallback=${r.timeResolvedFromFallback}`);
}

// ---- STAGE 2: player stat lines -------------------------------------------
if (stage === 'all' || stage === 'stats') {
  const mid = await seasonCounts(league.id);
  if (mid.matches === 0) {
    console.error(`REFUSING stage 2: no matches rows for ${season}. Run --stage=games first ` +
                  '(every stat row would be skipped as no-match-game).');
    process.exit(2);
  }
  log('');
  log(`STAGE 2  stat lines  (BDL /nfl/v1/stats, ${mid.matches} matches available)`);
  report.stats = await syncNflSeason({ season, log: (m) => log(`  ${m}`) });
}

// ---- report ---------------------------------------------------------------
const after = await seasonCounts(league.id);
report.after = after;
log('');
log('DELTA');
log(`  matches      ${before.matches} -> ${after.matches}   (+${after.matches - before.matches};  REG ${after.reg}, POST ${after.post})`);
log(`  stat rows    ${before.statRows} -> ${after.statRows}   (+${after.statRows - before.statRows})`);
log(`  nfl_players  ${before.playersTable} -> ${after.playersTable}   (+${after.playersTable - before.playersTable} created)`);
if (report.stats) {
  const created = after.playersTable - before.playersTable;
  log(`  players seen in ${season} stream: ${report.stats.distinctPlayers}` +
      `  (created ${created}, resolved existing ${report.stats.distinctPlayers - created})`);
  log(`  rejected: ${report.stats.skippedNoMatchGame} no-match-game, ${report.stats.skippedNoPlayer} no-player`);
}
log(`  elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
log('');
log(JSON.stringify(report));
