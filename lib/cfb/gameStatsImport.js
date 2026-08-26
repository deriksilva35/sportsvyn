// lib/cfb/gameStatsImport.js - land CFB box scores, one week per call.
//
// ONE CALL PER COMPLETED WEEK, and "completed" means the week's games are
// FINAL, not that the calendar day has passed - the sports-day law. A week
// fetched while games are in progress would write half a box score and then
// need re-running, which is safe (the upsert corrects) but pointless.
//
// seasonType IS ALWAYS EXPLICIT. Omitting it does NOT mean "regular season":
// /games/players?year=2025&week=1 returns 191 games, which is the regular
// week's 141 PLUS all 50 postseason week-1 games. The backfill leaned on that
// and imported the postseason twice - harmlessly, because the upsert corrected
// it, but the double write is what made a write-attempt counter disagree with
// the row count and cost an afternoon to explain. Asserted, not assumed:
//     regular      141 games
//     postseason    50 games
//     intersection   0
//     union        191 = the parameterless result, exactly
//
// AND THE LEDGER SEPARATES INSERTS FROM UPDATES, because "written" meaning
// write-attempts is precisely how that artifact hid. xmax = 0 on the returned
// row is Postgres telling us the row was inserted rather than updated.
//
// TWO FILTERS, AND THEY COST VERY DIFFERENT AMOUNTS. Measured on 2025 week 1:
//   game not held    1,630 rows (14.0%) - CFBD returns every division, 191
//                    games, and we carry 142 of them
//   player not held    149 rows (1.3%)
// Conditioned on a game we hold, the player match is 98.5%. Both are counted
// and reported per week; neither is ever silently dropped.

import { sql } from '../db.js';
import { pivotWeek, GAME_COLUMN_NAMES } from './gameStats.js';

const BASE = 'https://apinext.collegefootballdata.com';

async function cfbdGet(pathAndQuery) {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error('CFBD_API_KEY missing in env');
  const res = await fetch(`${BASE}${pathAndQuery}`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`CFBD ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function rosterMap() {
  const rows = await sql`
    SELECT p.id, p.external_ids->>'cfbd_player_id' AS pid FROM players p
      JOIN teams t ON t.id = p.current_team_id
      JOIN leagues lg ON lg.id = t.league_id
     WHERE lg.slug = 'cfb' AND p.external_ids ? 'cfbd_player_id'`;
  return new Map(rows.map((r) => [r.pid, r.id]));
}

/** cfbd game id -> our match, with the two team names so the row can say "at TCU". */
async function matchMap(season) {
  const rows = await sql`
    SELECT m.id, m.external_ids->>'cfbd_game_id' AS gid, m.week, m.season_phase,
           m.home_score, m.away_score, m.status,
           h.name AS home_name, h.short_name AS home_short,
           a.name AS away_name, a.short_name AS away_short
      FROM matches m
      JOIN leagues lg ON lg.id = m.league_id
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE lg.slug = 'cfb' AND m.season_year = ${season} AND m.external_ids ? 'cfbd_game_id'`;
  return new Map(rows.map((r) => [r.gid, r]));
}

const HEAD = ['player_id', 'match_id', 'season', 'week', 'season_phase',
  'team_name', 'opponent', 'result'];
const ALL = [...HEAD, ...GAME_COLUMN_NAMES];
const CHUNK = 500;

async function upsertChunk(rows) {
  if (!rows.length) return 0;
  const cols = ALL.length;
  const values = rows.map((_, i) => {
    const b = i * cols;
    return `(${ALL.map((__, j) => `$${b + j + 1}`).join(',')})`;
  }).join(',');
  const params = rows.flatMap((r) => [
    r.playerId, r.matchId, r.season, r.week ?? null, r.seasonPhase ?? null,
    r.team ?? null, r.opponent ?? null, r.result ?? null,
    ...GAME_COLUMN_NAMES.map((c) => (r.stats[c] === undefined ? null : r.stats[c])),
  ]);
  const setList = [...ALL.slice(2), 'updated_at']
    .map((c) => (c === 'updated_at' ? 'updated_at = now()' : `${c} = EXCLUDED.${c}`)).join(', ');
  // (xmax = 0) is true only for a row this statement INSERTED; an updated row
  // carries the locking transaction id. It is the cheapest honest way to tell
  // the two apart without a second query.
  const back = await sql.query(
    `INSERT INTO cfb_player_game_stats (${ALL.join(', ')}) VALUES ${values}
     ON CONFLICT (player_id, match_id) DO UPDATE SET ${setList}
     RETURNING (xmax = 0) AS inserted`,
    params,
  );
  let inserted = 0;
  for (const r of back) if (r.inserted === true || r.inserted === 't') inserted++;
  return { attempted: rows.length, inserted, updated: rows.length - inserted };
}

/** Import one (season, phase, week). dryRun fetches and counts, writing nothing. */
export async function importCfbWeek(season, week, {
  seasonPhase = 'REG', dryRun = false, roster = null, matches = null,
} = {}) {
  const seasonType = seasonPhase === 'POST' ? 'postseason' : 'regular';
  const q = `/games/players?year=${season}&seasonType=${seasonType}&week=${week}`;
  const raw = await cfbdGet(q);
  const { rows, unmapped } = pivotWeek(raw, { season, week, seasonPhase });

  const rmap = roster ?? await rosterMap();
  const mmap = matches ?? await matchMap(season);

  const batch = [];
  let noGame = 0, noPlayer = 0;
  for (const r of rows) {
    const m = mmap.get(r.providerGameId);
    if (!m) { noGame++; continue; }
    const playerId = rmap.get(r.providerPlayerId);
    if (playerId == null) { noPlayer++; continue; }
    // Which side was he on? The payload's team name against the match's two.
    const isHome = r.team === m.home_name || r.team === m.home_short;
    const oppName = isHome ? (m.away_short || m.away_name) : (m.home_short || m.home_name);
    const us = isHome ? m.home_score : m.away_score;
    const them = isHome ? m.away_score : m.home_score;
    const result = (m.status === 'final' && us != null && them != null)
      ? `${us > them ? 'W' : us < them ? 'L' : 'T'} ${us}-${them}` : null;
    batch.push({
      ...r, playerId, matchId: m.id,
      week: m.week ?? r.week, seasonPhase: m.season_phase ?? seasonPhase,
      opponent: `${isHome ? 'vs' : 'at'} ${oppName ?? '—'}`, result,
    });
  }

  let inserted = 0, updated = 0, attempted = 0;
  if (!dryRun) {
    for (let i = 0; i < batch.length; i += CHUNK) {
      const c = await upsertChunk(batch.slice(i, i + CHUNK));
      attempted += c.attempted; inserted += c.inserted; updated += c.updated;
    }
  }
  return {
    season, week, seasonPhase, seasonType, requests: 1, games: raw.length,
    rows: rows.length, matched: batch.length, noGame, noPlayer,
    // THREE numbers, not one: attempted is what the old `written` meant, and
    // it is the one that can exceed the row count.
    attempted, inserted, updated, dryRun,
    unmapped: [...unmapped.entries()],
  };
}

export { rosterMap, matchMap };
