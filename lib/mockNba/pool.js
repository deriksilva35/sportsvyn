// lib/mockNba/pool.js - the NBA mock draft's pool (sun-5).
//
// WHO: every player on a current BDL active roster (lib/six/pool.js fetchActive -
// the BDL door) with a line LAST SEASON (lib/six/pool.js fetchAverages), ranked
// by SV value (lib/mockNba/scoring.js: last season's points-league FP/G x games
// played). Plus this year's ROOKIES - no NBA line yet - placed by NBA draft slot:
// the #1 pick takes the value of the veteran ranked ROOKIE_BASE, each later pick
// ROOKIE_STEP ranks lower. Second-rounders and undrafted players with no line
// are left out. The pool keeps the best POOL_MAX.
//
// Built daily by /api/cron/nba-mock-pool into nba_mock_pool (migration 137); the
// page reads that one row.

import { sql as defaultSql } from '../db.js';
import { fetchActive, fetchAverages } from '../six/pool.js';
import { fppg, svValue } from './scoring.js';
import { TEAMS, ROUNDS } from './roster.js';

export const SEASON = 2026;            // the 2026-27 season being drafted for
export const LAST_SEASON = SEASON - 1; // the averages it is ranked on
export const POOL_MAX = 260;
export const POOL_MIN = TEAMS * ROUNDS + 24; // 180: every pick, and a choice at the last
export const ROOKIE_BASE = 40;
export const ROOKIE_STEP = 4;

const fullName = (p) => `${String(p?.first_name ?? '').trim()} ${String(p?.last_name ?? '').trim()}`.trim();

/**
 * PURE. BDL roster rows + last season's averages (Map(id -> stats)) -> pool rows,
 * best first, ranked 1..n: { id, name, pos, team, fppg, gp, sv, rank, rookie, draftNumber }.
 */
export function shapeNbaMockPool(roster, averages, { season = SEASON, max = POOL_MAX } = {}) {
  const vets = []; const rookies = [];
  for (const p of roster ?? []) {
    const id = Number(p.id);
    const base = { id, name: fullName(p), pos: String(p.position ?? '').trim() || 'F', team: p.team?.abbreviation ?? null };
    const s = averages.get(String(p.id)) ?? averages.get(id) ?? null;
    const fp = fppg(s);
    if (fp != null && Number(s.gp) > 0) {
      vets.push({ ...base, fppg: fp, gp: Number(s.gp), sv: svValue(fp, s.gp), rookie: false, draftNumber: p.draft_number ?? null });
    } else if (Number(p.draft_year) === season && Number(p.draft_round) === 1 && p.draft_number != null) {
      rookies.push({ ...base, fppg: null, gp: 0, sv: null, rookie: true, draftNumber: Number(p.draft_number) });
    }
  }
  vets.sort((a, b) => b.sv - a.sv || a.name.localeCompare(b.name));
  for (const r of rookies) {
    const at = Math.min(vets.length - 1, ROOKIE_BASE - 1 + (r.draftNumber - 1) * ROOKIE_STEP);
    r.sv = at >= 0 ? vets[at].sv - 1 : 0;
  }
  return [...vets, ...rookies]
    .sort((a, b) => b.sv - a.sv || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Build the pool from BDL (about 13 calls). */
export async function buildNbaMockPool({ fetchImpl = fetch, key } = {}) {
  const opts = key ? { fetchImpl, key } : { fetchImpl };
  const roster = (await fetchActive([], opts)).rows;
  const ids = roster.map((p) => String(p.id));
  const avg = await fetchAverages(LAST_SEASON, ids, opts);
  const averages = new Map(avg.rows.map((r) => [String(r?.player?.id), r?.stats ?? null]));
  return shapeNbaMockPool(roster, averages);
}

/** Store (upsert) one season's pool. Refuses a pool too small to draft. */
export async function storeNbaMockPool(rows, { sql = defaultSql, season = SEASON } = {}) {
  if ((rows?.length ?? 0) < POOL_MIN) throw new Error(`nba mock pool too small: ${rows?.length ?? 0} < ${POOL_MIN}`);
  await sql`
    INSERT INTO nba_mock_pool (season_year, built_at, rows) VALUES (${season}, now(), ${JSON.stringify(rows)}::jsonb)
    ON CONFLICT (season_year) DO UPDATE SET built_at = EXCLUDED.built_at, rows = EXCLUDED.rows`;
  return rows.length;
}

/** The stored pool, or null. */
export async function readNbaMockPool({ sql = defaultSql, season = SEASON } = {}) {
  const [r] = await sql`SELECT built_at, rows FROM nba_mock_pool WHERE season_year = ${season}`;
  return r ? { builtAt: new Date(r.built_at).toISOString(), rows: r.rows } : null;
}
