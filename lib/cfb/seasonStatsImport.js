// lib/cfb/seasonStatsImport.js - land CFBD season stats in the wide table.
//
// COST, MEASURED NOT ESTIMATED. /stats/player/season?year= is ONE call for the
// entire league - 139,136 long rows for 2025, ~12 seconds - and the scope is
// applied to what we KEEP, in code, after the fetch. Asking per team would
// honour the same scope at 243 calls per season for an identical result. Same
// law the roster import runs under.
//
// UNMATCHED PLAYERS ARE COUNTED, NOT SILENTLY DROPPED. The table's FK points at
// the roster imported in 076, which is a 2025 roster - so a 2023 season row
// belongs to a player we hold only if he was still on a roster in 2025. The
// match rate falls off with age exactly as that implies:
//     2025  13,589 of 14,445   (94%)
//     2024   9,227 of 13,852   (67%)
//     2023   5,943 of 13,567   (44%)
// That is not loss, it is scope: those are players who left college. The number
// is reported every run so it can never quietly become a bug.

import { sql } from '../db.js';
import { pivotSeasonRows, WIDE_COLUMN_NAMES } from './seasonStats.js';

const BASE = 'https://apinext.collegefootballdata.com';

async function cfbdGet(pathAndQuery) {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error('CFBD_API_KEY missing in env');
  const res = await fetch(`${BASE}${pathAndQuery}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`CFBD ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** cfbd player id -> our players.id, for the CFB league only. */
async function rosterMap() {
  const rows = await sql`
    SELECT p.id, p.external_ids->>'cfbd_player_id' AS pid
      FROM players p
      JOIN teams t   ON t.id = p.current_team_id
      JOIN leagues lg ON lg.id = t.league_id
     WHERE lg.slug = 'cfb' AND p.external_ids ? 'cfbd_player_id'`;
  return new Map(rows.map((r) => [r.pid, r.id]));
}

const CHUNK = 500;
// player_id, season, team_name, conference, position + the wide columns.
const HEAD = ['player_id', 'season', 'team_name', 'conference', 'position'];
const ALL = [...HEAD, ...WIDE_COLUMN_NAMES];

/**
 * One multi-row upsert per chunk, for the reason the roster import learned:
 * per-row upserts over HTTP measured ~4 rows/sec, which is over two hours for
 * 28,759 rows. The conflict target is the (player_id, season) primary key, so
 * a re-import corrects a season rather than duplicating it.
 */
async function upsertChunk(rows) {
  if (!rows.length) return 0;
  const cols = ALL.length;
  const values = rows.map((_, i) => {
    const b = i * cols;
    return `(${ALL.map((__, j) => `$${b + j + 1}`).join(',')})`;
  }).join(',');
  const params = rows.flatMap((r) => [
    r.playerId, r.season, r.team ?? null, r.conference ?? null, r.position ?? null,
    ...WIDE_COLUMN_NAMES.map((c) => (r.stats[c] === undefined ? null : r.stats[c])),
  ]);
  const setList = [...ALL.slice(2), 'updated_at']
    .map((c) => (c === 'updated_at' ? 'updated_at = now()' : `${c} = EXCLUDED.${c}`))
    .join(', ');
  await sql.query(
    `INSERT INTO cfb_player_season_stats (${ALL.join(', ')})
     VALUES ${values}
     ON CONFLICT (player_id, season) DO UPDATE SET ${setList}`,
    params,
  );
  return rows.length;
}

/**
 * Import one season. `dryRun` fetches and pivots and reports, writing nothing -
 * the shape a 28,759-row write is checked in before it is allowed to happen.
 */
export async function importCfbSeason(season, { dryRun = false } = {}) {
  const raw = await cfbdGet(`/stats/player/season?year=${season}`);
  const { rows, unmapped } = pivotSeasonRows(raw);
  const map = await rosterMap();

  const batch = [];
  let unmatched = 0;
  for (const r of rows) {
    const playerId = map.get(r.providerPlayerId);
    if (playerId == null) { unmatched++; continue; }
    batch.push({ ...r, playerId });
  }

  let written = 0;
  if (!dryRun) {
    for (let i = 0; i < batch.length; i += CHUNK) {
      written += await upsertChunk(batch.slice(i, i + CHUNK));
    }
  }

  return {
    season,
    requests: 1,
    longRows: raw.length,
    playerSeasons: rows.length,
    matched: batch.length,
    unmatched,
    written: dryRun ? 0 : written,
    dryRun,
    // Deliberately-unmapped derived ratios show up here every run. They are not
    // a defect; a NEW pair appearing here would be.
    unmapped: [...unmapped.entries()].sort((a, b) => b[1] - a[1]),
  };
}
