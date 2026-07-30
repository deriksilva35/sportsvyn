// scripts/sim-snapshot.mjs — MANUAL ADP snapshot into sim_player_pool.
//
// The standing path is the cron: /api/cron/adp-snapshot, daily 11:00 UTC. This
// script is the hand-run companion for what a cron can't cover — seeding a fresh
// database, backfilling a snapshot_date the cron missed, or forcing a refresh
// while working locally. It calls the SAME snapshotPool() with the SAME
// LAUNCH_PRESET_PAIRS the cron uses, so a hand-run and a tick cannot disagree
// about what "the pool" is.
//
// Committed deliberately: the pool is the draft sim's spine, and an untracked
// one-off must never again be the only way to write it.
//
// Run (DEV; refuses prod by design):
//   node scripts/sim-snapshot.mjs                 # today, resolved season year
//   node scripts/sim-snapshot.mjs 2026-07-16      # a specific snapshot_date
//   node scripts/sim-snapshot.mjs 2026-07-16 2026 # ... and an explicit FFC year
//
// Set FFC_CACHE_DIR to keep the raw FFC responses for inspection (ffc.js reads it;
// inert when unset).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(path.resolve(__dirname, '..', '.env.local'));

// Same guard as the other DEV scripts: never let a hand-run touch prod.
if (new URL(process.env.DATABASE_URL).hostname.includes('winter-dawn')) throw new Error('REFUSE: PROD');

const [dateArg, yearArg] = process.argv.slice(2);
if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  throw new Error(`snapshot_date must be YYYY-MM-DD, got '${dateArg}'`);
}

const { snapshotPool } = await import('../lib/fantasy/ffc.js');
const { LAUNCH_PRESET_PAIRS } = await import('../lib/fantasy/config.js');
const { resolveSeasonYear } = await import('../lib/pollers/seasonResolver.js');

const now = new Date();
const snapshotDate = dateArg ?? now.toISOString().slice(0, 10);
const year = yearArg ? Number(yearArg) : resolveSeasonYear(now);

console.log(`snapshot_date: ${snapshotDate} | ffc year: ${year} | pairs: ${LAUNCH_PRESET_PAIRS.length}`);
const s = await snapshotPool(snapshotDate, LAUNCH_PRESET_PAIRS, { year });
console.log('total upserted:', s.totalUpserted);
for (const p of s.perPair) {
  console.log(`  ${p.scoringFormat}/${p.teamsCount}: ${p.players} players ` +
    `(ffc window ${p.ffcMeta.start_date}..${p.ffcMeta.end_date}, ${p.ffcMeta.total_drafts} drafts)`);
}
