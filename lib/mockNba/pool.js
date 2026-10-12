// lib/mockNba/pool.js - the NBA mock draft's pool (sun-5, sun-7).
//
// WHO: every player on a current active roster (lib/six/pool.js fetchActive -
// the stats feed's door) with a line LAST SEASON (lib/six/pool.js fetchAverages),
// plus this year's first-round ROOKIES (no line yet). Each row keeps last
// season's PER-GAME LINE (`s`), so the page can rank under any scoring
// (lib/mockNba/rank.js); the stored order is the default (standard points) SVP.
// The pool keeps the best POOL_MAX by that order.
//
// A PLAYER WHO MISSED LAST SEASON (an injured star - no line at all) is ranked on
// the season before (`s.season` says which, `prior: true`), rather than dropped:
// a draft without him is not a draft anyone would run (sun-7).
//
// SVP v2 (sun-8): every row also keeps the season before (`s2`) for the 65/35
// projection, the feed's age (`s.age`) for the age curve, and `out: true` when
// the injury report lists him Out today (a badge only; SVP is unchanged).
//
// Built daily by /api/cron/nba-mock-pool into nba_mock_pool (migration 137); the
// page reads that one row.

import { sql as defaultSql } from '../db.js';
import { fetchActive, fetchAverages, fetchInjuries, isOutStatus } from '../six/pool.js';
import { rankPool } from './rank.js';

export const SEASON = 2026;            // the 2026-27 season being drafted for
export const LAST_SEASON = SEASON - 1; // the averages it is ranked on
export const POOL_MAX = 560;
export const POOL_MIN = 180;            // 12 x 13 picks and a choice at the last

const fullName = (p) => `${String(p?.first_name ?? '').trim()} ${String(p?.last_name ?? '').trim()}`.trim();
const r1 = (v) => Math.round(Number(v ?? 0) * 10) / 10;
const r3 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 1000) / 1000);

/** A stats-feed averages row -> the per-game line we keep (`s`), or null without games. */
export function lineOf(st, season = LAST_SEASON) {
  if (!st || !(Number(st.gp) > 0)) return null;
  return {
    season, gp: Number(st.gp), min: r1(st.min),
    pts: r1(st.pts), reb: r1(st.reb), ast: r1(st.ast), stl: r1(st.stl), blk: r1(st.blk),
    fg3m: r1(st.fg3m), fgm: r1(st.fgm), fga: r1(st.fga), ftm: r1(st.ftm), fta: r1(st.fta),
    tov: r1(st.turnover ?? st.tov), fg_pct: r3(st.fg_pct), ft_pct: r3(st.ft_pct),
    age: Number(st.age) > 0 ? Number(st.age) : null,
  };
}

/**
 * PURE. Active roster rows + last season's averages (Map(id -> stats)) -> pool rows,
 * default-SVP order: { id, name, pos, team, s, rookie, draftNumber, fppg, sv, svp, rank }.
 */
export function shapeNbaMockPool(roster, averages, { season = SEASON, max = POOL_MAX, prior = new Map(), out = new Set() } = {}) {
  const rows = [];
  for (const p of roster ?? []) {
    const id = Number(p.id);
    const base = { id, name: fullName(p), pos: String(p.position ?? '').trim() || 'F', team: p.team?.abbreviation ?? null };
    const s = lineOf(averages.get(String(p.id)) ?? averages.get(id) ?? null, season - 1);
    const s2 = lineOf(prior.get(String(p.id)) ?? prior.get(id) ?? null, season - 2);
    if (out.has(String(p.id))) base.out = true;
    if (s) rows.push({ ...base, s, s2, rookie: false, draftNumber: p.draft_number ?? null });
    else if (s2) rows.push({ ...base, s: s2, s2: null, prior: true, rookie: false, draftNumber: p.draft_number ?? null });
    else if (Number(p.draft_year) === season && Number(p.draft_round) === 1 && p.draft_number != null) {
      rows.push({ ...base, s: null, rookie: true, draftNumber: Number(p.draft_number) });
    }
  }
  return rankPool(rows).slice(0, max);
}

/** Build the pool from the feed (about 30 calls): rosters, two seasons of averages, the injury report. */
export async function buildNbaMockPool({ fetchImpl = fetch, key } = {}) {
  const opts = key ? { fetchImpl, key } : { fetchImpl };
  const roster = (await fetchActive([], opts)).rows;
  const ids = roster.map((p) => String(p.id));
  const avg = await fetchAverages(LAST_SEASON, ids, opts);
  const averages = new Map(avg.rows.map((r) => [String(r?.player?.id), r?.stats ?? null]));
  const before = await fetchAverages(LAST_SEASON - 1, ids, opts);
  const prior = new Map(before.rows.map((r) => [String(r?.player?.id), r?.stats ?? null]));
  // The injury report is a badge, never a reason to fail the build.
  const inj = await fetchInjuries([], opts).catch(() => ({ rows: [] }));
  const out = new Set(inj.rows.filter((r) => isOutStatus(r?.status)).map((r) => String(r?.player?.id)));
  return shapeNbaMockPool(roster, averages, { prior, out });
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
