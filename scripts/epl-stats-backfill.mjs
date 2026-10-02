#!/usr/bin/env node
// scripts/epl-stats-backfill.mjs - re-import EPL per-player match stats for
// finished matchweeks, through the same importer the live poller uses
// (lib/soccer/playerStatsImport.js), so rows imported before migration 121
// gain penalties saved/missed, own goals, on/off minutes and conceded-on-pitch.
//
// ONE API-Sports REQUEST PER FIXTURE (/fixtures?id=), i.e. 10 per matchweek.
// DRY RUN BY DEFAULT: lists the fixtures it would import and stops.
//
//   set -a && . ./.env.local && set +a
//   node scripts/epl-stats-backfill.mjs 2026 1-5                  # dry run, DEV
//   node scripts/epl-stats-backfill.mjs 2026 1-5 --apply          # DEV
//   DATABASE_URL="$PROD_DATABASE_URL" node scripts/epl-stats-backfill.mjs 2026 1-5 --apply
//
// --from <file.json>   read fixtures from a recorded /fixtures?ids= payload
//                      ({ fixtures: [...] } or [...]) instead of the API, and
//                      also write each match's final status/score from it
//                      (DEV only: a refused run if DATABASE_URL is PROD's).

import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { importEplPlayerStats } from '../lib/soccer/playerStatsImport.js';

const args = process.argv.slice(2);
const season = Number(args[0]);
const [w0, w1] = String(args[1] ?? '').split('-').map(Number);
const apply = args.includes('--apply');
const fromIdx = args.indexOf('--from');
const fromFile = fromIdx >= 0 ? args[fromIdx + 1] : null;
if (!season || !w0) {
  console.error('usage: node scripts/epl-stats-backfill.mjs <season> <week|from-to> [--apply] [--from file.json]');
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const isProd = process.env.PROD_DATABASE_URL && url === process.env.PROD_DATABASE_URL;
if (fromFile && isProd) { console.error('REFUSED: --from writes match status from a file and is DEV-only'); process.exit(1); }
console.log(`[epl-stats-backfill] target ${isProd ? 'PROD' : 'DEV'} (${new URL(url).host}) season ${season} weeks ${w0}-${w1 || w0} ${apply ? 'APPLY' : 'dry run'}`);

const sql = neon(url);
const recorded = fromFile ? (() => {
  const j = JSON.parse(readFileSync(fromFile, 'utf8'));
  const list = Array.isArray(j) ? j : j.fixtures;
  return new Map(list.map((f) => [String(f.fixture.id), f]));
})() : null;

const matches = await sql`
  SELECT m.id, m.slug, m.week, m.status, m.external_ids->>'api_sports' AS fx
    FROM matches m JOIN leagues l ON l.id = m.league_id
   WHERE l.slug = 'epl' AND m.season_year = ${season}
     AND m.week BETWEEN ${w0} AND ${w1 || w0}
     AND m.external_ids->>'api_sports' IS NOT NULL
   ORDER BY m.kickoff_at`;
console.log(`${matches.length} fixtures`);

if (recorded) {
  for (const m of matches) {
    const f = recorded.get(String(m.fx));
    if (!f || f.fixture?.status?.short !== 'FT') continue;
    console.log(`  ${m.slug}: final ${f.goals.home}-${f.goals.away}${apply ? '' : ' (dry)'}`);
    if (apply) {
      await sql`UPDATE matches SET status = 'final', home_score = ${f.goals.home}, away_score = ${f.goals.away}, updated_at = now()
                 WHERE id = ${m.id}`;
    }
  }
}

if (!apply) { for (const m of matches) console.log(`  would import ${m.slug} (${m.status})`); process.exit(0); }

const fetchPlayers = recorded
  ? async (fx) => { const f = recorded.get(String(fx)); return { teams: f?.players ?? [], fixture: f ?? null, budget: null }; }
  : undefined;
const r = await importEplPlayerStats(sql, { matchIds: matches.map((m) => m.id), ...(fetchPlayers ? { fetchPlayers } : {}) });
console.log(`[epl-stats-backfill] fixtures ${r.fixtures} inserted ${r.inserted} updated ${r.updated} unmatched ${r.unmatchedPlayers} budget ${JSON.stringify(r.budget)}`);
