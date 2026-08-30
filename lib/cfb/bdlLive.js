// lib/cfb/bdlLive.js — the live box score, from the secondary feed.
//
// SOURCE PER GAME STATE, and this file owns exactly one half of it: it writes
// only while our status is 'live'. The complete CFBD import owns the game from
// final onward, and the two are never blended (see migration 080).
//
// TWO DIALECTS, MAPPED AT THE BOUNDARY. The census pinned 19 fields that map
// onto cfb_player_game_stats' own column names plus 3 the live feed alone
// carries. Mapping here, once, means relay 2's reader reads one vocabulary
// whichever source answered. An unmapped key is COUNTED and reported, never
// coerced into a column it does not mean.

import { sql } from '../db.js';

const BASE = 'https://api.balldontlie.io';

/**
 * THE VOCABULARY. Left is the provider's key, right is our column — and the
 * right-hand side is deliberately identical to cfb_player_game_stats.
 */
export const STAT_MAP = Object.freeze({
  passing_completions: 'pass_cmp',
  passing_attempts: 'pass_att',
  passing_yards: 'pass_yds',
  passing_touchdowns: 'pass_td',
  passing_interceptions: 'pass_int',
  rushing_attempts: 'rush_car',
  rushing_yards: 'rush_yds',
  rushing_touchdowns: 'rush_td',
  rushing_long: 'rush_long',
  receptions: 'rec',
  receiving_yards: 'rec_yds',
  receiving_touchdowns: 'rec_td',
  receiving_long: 'rec_long',
  total_tackles: 'tackles_tot',
  solo_tackles: 'tackles_solo',
  tackles_for_loss: 'tfl',
  sacks: 'sacks',
  interceptions: 'def_int',
  passes_defended: 'pass_def',
  // The three the complete import has no column for.
  passing_qbr: 'pass_qbr',
  passing_rating: 'pass_rating',
  receiving_targets: 'rec_targets',
});

/** Keys that are structure, not statistics. */
const ENVELOPE = new Set(['player', 'team', 'game']);

/**
 * TEAM-NAME ALIASES, WRITTEN DOWN RATHER THAN FUZZY-MATCHED.
 *
 * The census measured 242 of 243 teams resolving on a normalised `college`
 * match. The single miss is not a formatting quirk and must not be "fixed"
 * with a looser comparison: we call it "St. Francis (PA)"; the feed calls it
 * "Saint Francis" (the Red Flash, Pennsylvania). The feed ALSO carries
 * "St. Francis (IN)" and "St Francis Illinois" — so a contains- or
 * fuzzy-match would happily attach a Pennsylvania line to an Indiana club.
 * One explicit entry, the way TEAM_ALIAS handles LA/WAS in the NFL arm.
 */
export const TEAM_ALIAS = Object.freeze({
  'saint francis': 'St. Francis (PA)',
});

export const normalizeName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** college name -> our team id, alias applied on the provider's side. */
export async function teamNameMap(leagueId) {
  const rows = await sql`
    SELECT id, name, short_name FROM teams WHERE league_id = ${leagueId}`;
  const m = new Map();
  for (const r of rows) {
    if (r.name) m.set(normalizeName(r.name), r.id);
    if (r.short_name) m.set(normalizeName(r.short_name), r.id);
  }
  return {
    resolve(college) {
      const aliased = TEAM_ALIAS[String(college ?? '').toLowerCase().trim()] ?? college;
      return m.get(normalizeName(aliased)) ?? null;
    },
  };
}

/** One provider row -> our row. PURE: no database, no clock, no network. */
export function toLineRow(s, { matchId, resolveTeam, unmapped } = {}) {
  const pid = Number(s?.player?.id);
  if (!Number.isFinite(pid)) return null;
  const college = s?.team?.college ?? null;
  const row = {
    match_id: matchId,
    bdl_player_id: pid,
    first_name: s.player.first_name ?? null,
    last_name: s.player.last_name ?? null,
    position: s.player.position ?? s.player.position_abbreviation ?? null,
    jersey_number: s.player.jersey_number ?? null,
    team_id: resolveTeam ? resolveTeam(college) : null,
    team_name: college,
  };
  for (const [k, v] of Object.entries(s)) {
    if (ENVELOPE.has(k)) continue;
    const col = STAT_MAP[k];
    // FAIL LOUD, DO NOT GUESS. A new stat key is counted so a provider
    // addition is noticed rather than silently dropped on the floor.
    if (!col) { unmapped?.push(k); continue; }
    row[col] = v ?? null;
  }
  return row;
}

export function bdlPlayerStatsFetcher({ base = BASE } = {}) {
  return async (bdlGameId) => {
    const key = process.env.BDL_API_KEY;
    if (!key) throw new Error('BDL_API_KEY missing in env');
    const res = await fetch(`${base}/ncaaf/v1/player_stats?game_ids[]=${bdlGameId}&per_page=100`, {
      headers: { Authorization: key },
    });
    if (!res.ok) throw new Error(`BDL ${res.status} on /ncaaf/v1/player_stats`);
    return (await res.json()).data ?? [];
  };
}

export function bdlGamesFetcher({ base = BASE } = {}) {
  return async (isoDate) => {
    const key = process.env.BDL_API_KEY;
    if (!key) throw new Error('BDL_API_KEY missing in env');
    const res = await fetch(`${base}/ncaaf/v1/games?dates[]=${isoDate}&per_page=100`, {
      headers: { Authorization: key },
    });
    if (!res.ok) throw new Error(`BDL ${res.status} on /ncaaf/v1/games`);
    return (await res.json()).data ?? [];
  };
}

/**
 * THE GAME-ID BRIDGE, RESOLVED ONCE AND CACHED ON THE MATCH.
 *
 * The two providers share no game id, so the join is date plus the two college
 * names. That costs a /games call, which is exactly the sort of thing that
 * must not happen on every 5-minute tick — so the answer is written to
 * external_ids.bdl_ncaaf_game_id and every later tick reads it from there.
 * A match that already carries the id makes NO call at all.
 */
export async function resolveBdlGameId(match, { fetchGames } = {}) {
  const cached = match.external_ids?.bdl_ncaaf_game_id;
  if (cached) return { id: Number(cached), cached: true, calls: 0 };

  const iso = new Date(match.kickoff_at).toISOString().slice(0, 10);
  const games = await (fetchGames ?? bdlGamesFetcher())(iso);
  const want = [normalizeName(match.home_name), normalizeName(match.away_name)].sort().join('|');
  const hit = (games ?? []).find((g) => {
    const pair = [normalizeName(g.home_team?.college), normalizeName(g.visitor_team?.college)]
      .sort().join('|');
    return pair === want;
  });
  if (!hit) return { id: null, cached: false, calls: 1 };

  await sql`
    UPDATE matches
       SET external_ids = COALESCE(external_ids, '{}'::jsonb)
                          || jsonb_build_object('bdl_ncaaf_game_id', ${String(hit.id)}),
           updated_at = now()
     WHERE id = ${match.id}`;
  return { id: hit.id, cached: false, calls: 1 };
}

export async function upsertLines(rows) {
  let n = 0;
  for (const r of rows) {
    await sql`
      INSERT INTO cfb_live_player_lines (
        match_id, bdl_player_id, first_name, last_name, position, jersey_number,
        team_id, team_name,
        pass_cmp, pass_att, pass_yds, pass_td, pass_int,
        rush_car, rush_yds, rush_td, rush_long,
        rec, rec_yds, rec_td, rec_long,
        tackles_tot, tackles_solo, tfl, sacks, def_int, pass_def,
        pass_qbr, pass_rating, rec_targets, data_provider_synced_at)
      VALUES (
        ${r.match_id}, ${r.bdl_player_id}, ${r.first_name}, ${r.last_name},
        ${r.position}, ${r.jersey_number}, ${r.team_id ?? null}, ${r.team_name},
        ${r.pass_cmp ?? null}, ${r.pass_att ?? null}, ${r.pass_yds ?? null},
        ${r.pass_td ?? null}, ${r.pass_int ?? null},
        ${r.rush_car ?? null}, ${r.rush_yds ?? null}, ${r.rush_td ?? null}, ${r.rush_long ?? null},
        ${r.rec ?? null}, ${r.rec_yds ?? null}, ${r.rec_td ?? null}, ${r.rec_long ?? null},
        ${r.tackles_tot ?? null}, ${r.tackles_solo ?? null}, ${r.tfl ?? null},
        ${r.sacks ?? null}, ${r.def_int ?? null}, ${r.pass_def ?? null},
        ${r.pass_qbr ?? null}, ${r.pass_rating ?? null}, ${r.rec_targets ?? null}, now())
      ON CONFLICT (match_id, bdl_player_id) DO UPDATE SET
        first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
        position = EXCLUDED.position, jersey_number = EXCLUDED.jersey_number,
        team_id = EXCLUDED.team_id, team_name = EXCLUDED.team_name,
        pass_cmp = EXCLUDED.pass_cmp, pass_att = EXCLUDED.pass_att,
        pass_yds = EXCLUDED.pass_yds, pass_td = EXCLUDED.pass_td, pass_int = EXCLUDED.pass_int,
        rush_car = EXCLUDED.rush_car, rush_yds = EXCLUDED.rush_yds,
        rush_td = EXCLUDED.rush_td, rush_long = EXCLUDED.rush_long,
        rec = EXCLUDED.rec, rec_yds = EXCLUDED.rec_yds,
        rec_td = EXCLUDED.rec_td, rec_long = EXCLUDED.rec_long,
        tackles_tot = EXCLUDED.tackles_tot, tackles_solo = EXCLUDED.tackles_solo,
        tfl = EXCLUDED.tfl, sacks = EXCLUDED.sacks,
        def_int = EXCLUDED.def_int, pass_def = EXCLUDED.pass_def,
        pass_qbr = EXCLUDED.pass_qbr, pass_rating = EXCLUDED.pass_rating,
        rec_targets = EXCLUDED.rec_targets,
        data_provider_synced_at = now(), updated_at = now()`;
    n += 1;
  }
  return n;
}

/**
 * Sync the live box score for every LIVE game on an open board.
 *
 * BOARD-SCOPED, the same bound plays-live uses. League-wide live box scores
 * are a cost decision, not this relay's: the board join caps the calls at the
 * number of games a reader is actually watching.
 */
export async function syncCfbLiveLines(leagueId, {
  fetchPlayerStats, fetchGames, dryRun = false,
} = {}) {
  const summary = {
    liveGames: 0, resolved: 0, unresolvedGameId: 0,
    rows: 0, written: 0, noTeam: 0, calls: 0, unmapped: [], perGame: [], dryRun,
  };

  // WRITE ONLY WHILE LIVE. The status test is in the query, so a game that has
  // finalised is never enumerated and no later branch can write to it.
  const live = await sql`
    SELECT DISTINCT m.id, m.slug, m.kickoff_at, m.external_ids,
           h.name AS home_name, a.name AS away_name
      FROM contests c
      CROSS JOIN LATERAL jsonb_array_elements(c.board) g
      JOIN matches m ON m.id = (g->>'match_id')::int
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE c.game_type = 'pickem' AND c.settled = false
       AND m.status = 'live' AND m.league_id = ${leagueId}`;
  summary.liveGames = live.length;
  if (!live.length) return summary;

  const tmap = await teamNameMap(leagueId);
  for (const m of live) {
    const { id: bdlId, cached, calls } = await resolveBdlGameId(m, { fetchGames });
    summary.calls += calls;
    if (bdlId == null) { summary.unresolvedGameId += 1; continue; }
    summary.resolved += 1;

    const raw = await (fetchPlayerStats ?? bdlPlayerStatsFetcher())(bdlId);
    summary.calls += 1;
    const rows = [];
    for (const s of raw ?? []) {
      const row = toLineRow(s, {
        matchId: m.id, resolveTeam: (c) => tmap.resolve(c), unmapped: summary.unmapped,
      });
      if (!row) continue;
      if (row.team_id == null) summary.noTeam += 1;
      rows.push(row);
    }
    summary.rows += rows.length;
    // RE-ASSERTED AT WRITE TIME. The game was live when we enumerated it; it
    // may have finalised during the fetch, and the complete import owns it
    // from that instant.
    const [still] = await sql`SELECT status FROM matches WHERE id = ${m.id}`;
    if (still?.status !== 'live') {
      summary.perGame.push({ match: m.id, bdlGameId: bdlId, rows: rows.length, skipped: 'went-final' });
      continue;
    }
    if (!dryRun) summary.written += await upsertLines(rows);
    summary.perGame.push({ match: m.id, bdlGameId: bdlId, cached, rows: rows.length });
  }
  summary.unmapped = [...new Set(summary.unmapped)];
  return summary;
}
