// lib/october/pool.js - who is pickable today, and what they are worth.
//
// ACTIVE IS A CLIENT-SIDE FILTER, and this was measured, not assumed:
// /mlb/v1/players?active=true RETURNS THE SAME PAGE as no filter at all -
// team 8 gives 100 rows and 24 active either way, first row Ryan Thompson,
// active:false, in both. The parameter is ignored. Filtering on the `active`
// field of the rows is the only thing that works, and a build that trusted
// the query string would have put 76 retired players in the picker.
//
// PPG IS SEASON POINTS THROUGH THE SCORING FUNCTION - the same function that
// settles the card, so the number in the picker and the number on the
// leaderboard are produced by one table. It reads the SEASON AGGREGATE rather
// than summing game rows: /mlb/v1/season_stats is one call a club against
// hundreds, and its totals are the same totals.
//
// CACHED DAILY, onto the contest that owns the day. One build a day, frozen
// beside the lineups and probables the board already freezes, so the PPG a
// reader sorted by at 10am is the PPG they picked against at 6pm.

import { sql } from '../db.js';
import { batPoints, armPoints, round1 } from '../mlb/fantasyPoints.js';

const BDL = 'https://api.balldontlie.io';
const PITCHER = new Set(['SP', 'RP', 'P']);

async function bdl(path) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetch(`${BDL}${path}`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on ${path}`);
  return (await res.json())?.data ?? [];
}

/** One club's roster, ACTIVE ONLY - filtered here because the API will not. */
export async function fetchRoster(bdlTeamId) {
  const rows = await bdl(`/mlb/v1/players?team_ids[]=${encodeURIComponent(bdlTeamId)}&per_page=100`);
  return rows.filter((p) => p?.active === true);
}

/** One club's season aggregates. */
export async function fetchSeasonStats(season, bdlTeamId) {
  return bdl(`/mlb/v1/season_stats?season=${encodeURIComponent(season)}&team_id=${encodeURIComponent(bdlTeamId)}&per_page=100`);
}

/**
 * THE ADAPTER, and it exists so there is exactly ONE scoring table in this
 * product. season_stats names its columns batting_h / pitching_k; the scoring
 * function speaks the game row's hits / strikeouts_pitched. Mapping here keeps
 * lib/mlb/fantasyPoints.js ignorant of which endpoint a number came from - and
 * keeps a second, drifting copy of the table from being written against these
 * names.
 */
export function asGameRow(s) {
  return {
    at_bats: s?.batting_ab, hits: s?.batting_h, doubles: s?.batting_2b,
    triples: s?.batting_3b, home_runs: s?.batting_hr, rbi: s?.batting_rbi,
    runs: s?.batting_r, walks: s?.batting_bb, stolen_bases: s?.batting_sb,
    // INNINGS BACK TO OUTS. season_stats sends pitching_ip as 182.1 meaning
    // 182 and a third; the scoring table pays per OUT, so the decimal is a
    // count of thirds and never a fraction. 182.1 -> 547, not 546.3.
    outs_recorded: ipToOuts(s?.pitching_ip),
    strikeouts_pitched: s?.pitching_k, wins: s?.pitching_w,
    earned_runs: s?.pitching_er, hits_allowed: s?.pitching_h, walks_allowed: s?.pitching_bb,
  };
}

export function ipToOuts(ip) {
  if (ip == null || ip === '') return null;
  const n = Number(ip);
  if (!Number.isFinite(n) || n < 0) return null;
  const whole = Math.floor(n);
  // ONE DECIMAL PLACE, AND IT IS THIRDS. Rounded rather than truncated because
  // 5.2 arrives from JSON as 5.199999999999999 often enough to matter.
  const thirds = Math.round((n - whole) * 10);
  return whole * 3 + (thirds >= 1 && thirds <= 2 ? thirds : 0);
}

/**
 * PPG for one player. PURE.
 *
 * THE KIND DECIDES THE DENOMINATOR as well as the table: a starter's value is
 * per START, not per appearance, and dividing a season's pitching by 162 would
 * rank every arm below every bat.
 */
export function ppgOf(seasonRow, kind) {
  const row = asGameRow(seasonRow);
  if (kind === 'arm') {
    const gp = Number(seasonRow?.pitching_gp) || 0;
    return gp > 0 ? round1(armPoints(row) / gp) : null;
  }
  const gp = Number(seasonRow?.batting_gp) || 0;
  return gp > 0 ? round1(batPoints(row) / gp) : null;
}

export const kindOfPosition = (pos) => (PITCHER.has(String(pos ?? '').trim().toUpperCase()) ? 'arm' : 'bat');

/**
 * PURE. Rosters + season stats -> the picker's rows for one game.
 *
 * SORTED ARM FIRST, THEN BATS BY PPG, which is the mock's own panel order:
 * Wheeler on top, then Acuña, Schwarber, Harper, Olson, Turner by descending
 * PPG. A player with no season line sorts last rather than being dropped - a
 * September call-up is pickable, he simply has no number yet.
 */
export function poolRows({ roster = [], seasonStats = [], matchId, teamAbbr, probableId = null }) {
  const statBy = new Map(seasonStats.map((s) => [String(s?.player?.id), s]));
  return roster.map((p) => {
    const kind = kindOfPosition(p.position);
    const s = statBy.get(String(p.id)) ?? null;
    return {
      playerId: String(p.id),
      name: p.full_name,
      short: shortName(p.full_name),
      position: p.position,
      kind,
      team: teamAbbr,
      matchId,
      ppg: s ? ppgOf(s, kind) : null,
      // THE PROBABLE IS THE ONLY ARM WORTH OFFERING FIRST. A bullpen arm may
      // not appear at all, and the card's arm slot is a start.
      probable: probableId != null && String(p.id) === String(probableId),
    };
  }).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'arm' ? -1 : 1;
    if (a.probable !== b.probable) return a.probable ? -1 : 1;
    return (b.ppg ?? -Infinity) - (a.ppg ?? -Infinity) || a.name.localeCompare(b.name);
  });
}

function shortName(full) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

/**
 * The day's whole pool, built once and cached onto the contest.
 *
 * BUILT FROM THE BOARD, not from the schedule: the board is the frozen
 * snapshot of which games this card covers, and a game added to the day after
 * the card opened is not on it.
 */
export async function octoberPool(contest, { rebuild = false } = {}) {
  if (!rebuild && contest?.meta?.pool) return contest.meta.pool;
  const board = contest?.board ?? [];
  const teamIds = [...new Set(board.flatMap((g) => [g.home_team_id, g.away_team_id]).filter((x) => x != null))];
  const bdlByTeam = new Map((await sql`
    SELECT id, abbreviation, external_ids->>'bdl_team_id' AS pid FROM teams WHERE id = ANY(${teamIds})`)
    .map((t) => [t.id, t]));

  const byGame = {};
  for (const g of board) {
    const rows = [];
    for (const [side, teamId] of [['home', g.home_team_id], ['away', g.away_team_id]]) {
      const t = bdlByTeam.get(teamId);
      if (!t?.pid) continue;
      const [roster, seasonStats] = await Promise.all([
        fetchRoster(t.pid).catch(() => []),
        fetchSeasonStats(contest.season_year, t.pid).catch(() => []),
      ]);
      rows.push(...poolRows({
        roster, seasonStats, matchId: g.match_id, teamAbbr: t.abbreviation,
        probableId: g.probables?.[side]?.id ?? null,
      }));
    }
    byGame[String(g.match_id)] = rows;
  }
  const pool = { builtAt: new Date().toISOString(), byGame };
  // CACHED ONTO THE DAY IT DESCRIBES. Top-level key, so the shallow merge is
  // the right depth and every sibling meta key survives.
  await sql`
    UPDATE contests SET meta = COALESCE(meta, '{}'::jsonb) || ${JSON.stringify({ pool })}::jsonb
     WHERE id = ${contest.id}`.catch(() => {});
  return pool;
}

/**
 * THE BURN READ: every player this reader has already spent this postseason,
 * with the day they spent them - the picker prints "used Sep 29".
 *
 * DERIVED FROM THE ENTRIES, no new table (the relay's own preference, and the
 * right one): a used_players table would be a second copy of the lineups able
 * to disagree with them, and the first disagreement would refuse a reader a
 * player they never picked. Migration 112 adds the one index this needs.
 *
 * IT COUNTS EVERY ENTRY, NOT JUST SETTLED ONES. A player picked into today's
 * card is spent the moment the slot locks - waiting for the day to settle
 * would let one player be used twice in the same week.
 */
export async function usedPlayers(userId, season, { excludeContestId = null } = {}) {
  if (userId == null) return new Map();
  const rows = await sql`
    SELECT c.puzzle_date, e.lineup
      FROM contest_entries e
      JOIN contests c ON c.id = e.contest_id
     WHERE e.user_id = ${userId}
       AND c.game_type = 'october' AND c.sport = 'mlb'
       AND c.season_year = ${season}
       AND (${excludeContestId}::int IS NULL OR c.id <> ${excludeContestId}::int)
     ORDER BY c.puzzle_date ASC`;
  const out = new Map();
  for (const r of rows) {
    for (const pick of Object.values(r.lineup ?? {})) {
      const id = pick?.playerId;
      if (id == null) continue;
      // FIRST USE WINS the label - a player cannot be used twice, so a second
      // row for one id means the data is wrong and the earlier date is the
      // one that made him unavailable.
      if (!out.has(String(id))) out.set(String(id), String(r.puzzle_date).slice(0, 10));
    }
  }
  return out;
}
