// lib/mockNfl/pool.js - the NFL mock draft's pool (mon-3).
//
// WHO: the licensed football ADP source's newest FULL PPR board (sim_player_pool,
// via lib/fantasy/drafts.js getPoolAt) - the top POOL_MAX by ADP, every kicker and
// defense on it included. ONE ADP FOR EVERY SCORING: the source's Half PPR and
// Standard boards are 10- and 8-team boards (another scale) and never reach
// BOARD_MIN, so the 12-team PPR board's order is the ADP column throughout.
//
// "FULL" BECAUSE THE BOARDS SHRINK IN SEASON: once the real drafts are done the
// source ranks only the players still being drafted (PPR: 271 on 12 Sep, 29 by
// October). A board under BOARD_MIN cannot fill a 14-team draft, so each format uses
// its newest board with at least BOARD_MIN players, and the page says its date. The
// in-season picture comes through SVP (this season's games). EACH ROW KEEPS: this season's and last season's
// stat TOTALS and games (lib/fantasy/playerStats.js getPlayerSeasonSummaries -
// the same numbers the sim's player panel shows; `s` / `s2`), the games his team
// has LEFT this regular season (`rem`, from the schedule), and his status on the
// feed's injury report (`inj`: Out, IR, ... - Questionable is not carried).
//
// Built daily by /api/cron/nfl-mock-pool into nfl_mock_pool (migration 140).

import { sql as defaultSql } from '../db.js';
import { getPoolAt } from '../fantasy/drafts.js';
import { getPlayerSeasonSummaries } from '../fantasy/playerStats.js';
import { fetchInjuries } from '../wire/injuries.js';

export const SEASON = 2026;
export const POOL_MAX = 300;
export const POOL_MIN = 200;
// A board must cover the biggest draft (14 teams x 16 spots) and leave a choice at the last pick.
export const BOARD_MIN = 240;
const POS = { PK: 'K', K: 'K', DEF: 'DST', DST: 'DST' };
// The injury report's status -> the badge. Questionable / Doubtful: no badge.
const BADGE = { Out: 'Out', IR: 'IR', 'IR-R': 'IR', 'PUP-R': 'IR', 'NFI-R': 'IR', 'Reserve-Sus': 'Susp' };

export const normName = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[.'’`]/g, '').replace(/-/g, ' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();

/** The newest board of a format with at least BOARD_MIN players: { teams, date } or null. */
async function newestFullBoard(fmt, sql) {
  const [r] = await sql`
    SELECT teams_count, snapshot_date FROM sim_player_pool
     WHERE scoring_format = ${fmt} AND source = 'ffc'
     GROUP BY teams_count, snapshot_date HAVING count(*) >= ${BOARD_MIN}
     ORDER BY snapshot_date DESC, (teams_count = 12) DESC LIMIT 1`;
  return r ? { teams: Number(r.teams_count), date: r.snapshot_date } : null;
}
const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

const line = (x) => (x && x.games > 0 ? { gp: x.games, t: x.totals ?? {} } : null);

/** PURE. Pool + summaries + games left + injuries -> stored rows, in PPR ADP order. */
export function shapeNflMockPool(boards, { now = {}, last = {}, rem = new Map(), injuries = new Map(), max = POOL_MAX } = {}) {
  const ppr = boards.ppr ?? [];
  return ppr.slice(0, max).map((r) => {
    const id = String(r.ffcPlayerId);
    const pos = POS[r.position] ?? r.position;
    const team = r.team ?? null;
    const inj = pos === 'DST' ? null : (injuries.get(`${normName(r.name)}|${team}`) ?? injuries.get(normName(r.name)) ?? null);
    return {
      id, name: r.name, pos, team, bye: r.bye ?? null, rookie: Boolean(r.rookie),
      adp: Number(r.adp) || null,
      s: line(now[id]), s2: line(last[id]),
      rem: team ? (rem.get(team) ?? 0) : 0,
      ...(inj ? { inj } : {}),
    };
  });
}

/** Build from the database and the injury feed. -> { rows, adpAsOf: 'YYYY-MM-DD' }. */
export async function buildNflMockPool({ sql = defaultSql, season = SEASON } = {}) {
  const b = await newestFullBoard('ppr', sql);
  if (!b) throw new Error(`no PPR ADP board of ${BOARD_MIN}+ players`);
  const boards = { ppr: await getPoolAt('ppr', b.teams, b.date) };
  const adpAsOf = iso(b.date);
  const ids = boards.ppr.slice(0, POOL_MAX).map((r) => String(r.ffcPlayerId));
  const [now, last] = await Promise.all([
    getPlayerSeasonSummaries(ids, 'ppr', season), getPlayerSeasonSummaries(ids, 'ppr', season - 1),
  ]);
  const games = await sql`
    SELECT t.abbreviation AS team, count(*)::int AS n
      FROM matches m JOIN leagues l ON l.id = m.league_id AND l.slug = 'nfl'
      JOIN teams t ON t.id IN (m.home_team_id, m.away_team_id)
     WHERE m.season_year = ${season} AND m.season_phase = 'REG' AND m.status <> 'final'
     GROUP BY t.abbreviation`;
  const rem = new Map(games.map((g) => [g.team, g.n]));
  // The injury report is a badge, never a reason to fail the build.
  const injuries = new Map();
  for (const x of await fetchInjuries({ maxPages: 10 }).catch(() => [])) {
    const badge = BADGE[String(x?.status ?? '').trim()];
    if (!badge) continue;
    const nm = normName(`${x.player?.first_name ?? ''} ${x.player?.last_name ?? ''}`);
    injuries.set(`${nm}|${x.player?.team?.abbreviation ?? ''}`, badge);
    if (!injuries.has(nm)) injuries.set(nm, badge);
  }
  return { rows: shapeNflMockPool(boards, { now, last, rem, injuries }), adpAsOf };
}

/** Store { rows, adpAsOf } (the row is { players, adpAsOf } in the rows column). */
export async function storeNflMockPool({ rows, adpAsOf }, { sql = defaultSql, season = SEASON } = {}) {
  if ((rows?.length ?? 0) < POOL_MIN) throw new Error(`nfl mock pool too small: ${rows?.length ?? 0} < ${POOL_MIN}`);
  await sql`
    INSERT INTO nfl_mock_pool (season_year, built_at, rows)
    VALUES (${season}, now(), ${JSON.stringify({ players: rows, adpAsOf })}::jsonb)
    ON CONFLICT (season_year) DO UPDATE SET built_at = EXCLUDED.built_at, rows = EXCLUDED.rows`;
  return rows.length;
}

/** { builtAt, rows, adpAsOf } or null. */
export async function readNflMockPool({ sql = defaultSql, season = SEASON } = {}) {
  const [r] = await sql`SELECT built_at, rows FROM nfl_mock_pool WHERE season_year = ${season}`;
  if (!r) return null;
  return { builtAt: new Date(r.built_at).toISOString(), rows: r.rows?.players ?? [], adpAsOf: r.rows?.adpAsOf ?? null };
}
