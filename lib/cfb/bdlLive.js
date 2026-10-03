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
 *
 * ONE DATED CALL PER TICK, NOT ONE PER GAME. League-wide, a Saturday's first
 * tick can find twenty-odd live games none of which is resolved yet, and the
 * /games answer for a date is the same list for every one of them. So the
 * tick hands this function a fetcher from sharedGamesFetcher(): the first
 * game to ask for a date makes the call, every other game on that date awaits
 * the same promise. `calls` here still says 1 for "this game needed the list";
 * what the tick COUNTS is the shared fetcher's size, the calls actually made.
 *
 * saveGameId is injectable for the unit tests only; the default is the
 * UPDATE below.
 */
export async function resolveBdlGameId(match, { fetchGames, saveGameId } = {}) {
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

  // jsonb_build_object IS VARIADIC "any", so a bare parameter handed to it has
  // no type Postgres can infer from context - "could not determine data type
  // of parameter $1", on every first-time resolution, every tick, since this
  // shipped. The ::text cast is the fix; it is not optional decoration.
  if (saveGameId) { await saveGameId(match.id, hit.id); return { id: hit.id, cached: false, calls: 1 }; }
  await sql`
    UPDATE matches
       SET external_ids = COALESCE(external_ids, '{}'::jsonb)
                          || jsonb_build_object('bdl_ncaaf_game_id', ${String(hit.id)}::text),
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
 * Every CFB match whose status is 'live', league-wide. EXPORTED so the unit
 * tests can stand a stub in for it and the DB test can prove the SQL parses.
 *
 * WRITE ONLY WHILE LIVE. The status test is in the query, so a game that has
 * finalised is never enumerated and no later branch can write to it.
 */
export async function liveCfbMatches(leagueId) {
  return sql`
    SELECT m.id, m.slug, m.kickoff_at, m.external_ids,
           h.name AS home_name, a.name AS away_name
      FROM matches m
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE m.status = 'live' AND m.league_id = ${leagueId}
     ORDER BY m.kickoff_at, m.id`;
}

/**
 * The /games-by-date fetcher, memoised for ONE tick. The first caller for a
 * date makes the call; every later caller awaits the same promise - including
 * a rejected one, so a 401 on the list is one failed call that every game on
 * that date reports, not twenty-five. `calls()` is the number actually made.
 * Built fresh per tick: a cache that outlived the tick would hide a game BDL
 * adds to the date later in the day.
 */
export function sharedGamesFetcher(fetchGames) {
  const inner = fetchGames ?? bdlGamesFetcher();
  const memo = new Map();
  const fn = (iso) => {
    if (!memo.has(iso)) memo.set(iso, Promise.resolve().then(() => inner(iso)));
    return memo.get(iso);
  };
  fn.calls = () => memo.size;
  return fn;
}

/** At most 5 games in flight. BDL allows 600/min; the bound is our wall time,
 * and Neon's, since each game also upserts ~40-60 rows one statement each. */
export const LIVE_LINES_CONCURRENCY = 5;
/** The overlay's own share of a tick. Measured 3 Oct 2026 on PROD: ~0.45 s per
 * game sequentially (fetch + upserts), so 25 live games at 5-wide is ~3 s -
 * 20 s is a ceiling for a slow provider, not an expectation. */
export const LIVE_LINES_BUDGET_MS = 20_000;

/** `p` resolved -> true; `ms` elapsed first -> false. The timer is cleared
 * either way, so a finished tick never leaves a 20 s timer holding the
 * process open. */
function settlesWithin(p, ms) {
  let t;
  const timer = new Promise((r) => { t = setTimeout(() => r(false), ms); });
  return Promise.race([p.then(() => true), timer]).finally(() => clearTimeout(t));
}

/**
 * Sync the live box score for EVERY live CFB game, league-wide.
 *
 * LEAGUE-WIDE, NOT BOARD-SCOPED (ruling sun-7, 4 Oct 2026). This used to
 * enumerate only live games on an unsettled Pick'em board, as a cost bound.
 * The box score is read on every game page, not just board games, and the cost
 * of widening it is measured and small: one /player_stats call per live game
 * per 5-minute tick (~25 at a Saturday peak, ~5 a minute against BDL's 600),
 * plus at most one /games call per kickoff DATE per tick, and only while some
 * live game still lacks its cached BDL id. A tick with no live CFB game still
 * makes no provider call at all.
 *
 * WALL TIME IS THE REAL COST, not the rate limit. This runs inside the
 * gridiron-games cron (maxDuration 120 s), whose cfb-games run alone has
 * already been measured at 104.7 s on a Saturday. So the games are fetched
 * LIVE_LINES_CONCURRENCY at a time, and no new game is STARTED after the
 * budget - the earlier of `budgetMs` from now and the caller's `deadlineAt`.
 * Games left over are counted in `skippedForBudget` and simply wait for the
 * next tick; a game already in flight is abandoned at the deadline
 * (`timedOut`) rather than awaited past it.
 */
export async function syncCfbLiveLines(leagueId, {
  fetchPlayerStats, fetchGames, dryRun = false,
  concurrency = LIVE_LINES_CONCURRENCY, budgetMs = LIVE_LINES_BUDGET_MS,
  deadlineAt = null, clock = Date.now,
  // DB seams, for the unit tests. The defaults are the real queries.
  listLive = liveCfbMatches, loadTeamMap = teamNameMap,
  readStatus = async (id) => (await sql`SELECT status FROM matches WHERE id = ${id}`)[0]?.status,
  writeLines = upsertLines, saveGameId = undefined,
} = {}) {
  const startedAt = clock();
  const stopAt = Math.min(startedAt + budgetMs, deadlineAt ?? Infinity);
  const summary = {
    liveGames: 0, resolved: 0, unresolvedGameId: 0,
    rows: 0, written: 0, noTeam: 0, calls: 0, gamesCalls: 0, statsCalls: 0,
    skippedForBudget: 0, timedOut: 0, elapsedMs: 0,
    unmapped: [], perGame: [], dryRun,
  };

  const live = await listLive(leagueId);
  summary.liveGames = live.length;
  if (!live.length) return summary;

  const tmap = await loadTeamMap(leagueId);
  const games = sharedGamesFetcher(fetchGames);
  const stats = fetchPlayerStats ?? bdlPlayerStatsFetcher();

  // ONE GAME PER TRY. Four days of this overlay died on ONE malformed
  // statement in resolveBdlGameId because a single throw inside this loop
  // used to abort the whole tick - the first game needing fresh resolution
  // took every OTHER live game down with it, silently, since sync.js's outer
  // catch turned the whole thing into a summary string nobody read. A bad
  // game is now recorded and skipped; its siblings still get written.
  async function syncOne(m) {
    try {
      const { id: bdlId, cached } = await resolveBdlGameId(m, { fetchGames: games, saveGameId });
      if (bdlId == null) { summary.unresolvedGameId += 1; return; }
      summary.resolved += 1;

      summary.statsCalls += 1;
      const raw = await stats(bdlId);
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
      const still = await readStatus(m.id);
      if (still !== 'live') {
        summary.perGame.push({ match: m.id, bdlGameId: bdlId, rows: rows.length, skipped: 'went-final' });
        return;
      }
      if (!dryRun) summary.written += await writeLines(rows);
      summary.perGame.push({ match: m.id, bdlGameId: bdlId, cached, rows: rows.length });
    } catch (e) {
      summary.perGame.push({ match: m.id, error: String(e?.message ?? e) });
    }
  }

  // THE POOL. Each worker takes the next game only while the budget allows;
  // a game is either fully attempted or never started, never half-counted.
  let next = 0;
  async function worker() {
    while (next < live.length && clock() < stopAt) {
      const m = live[next++];
      const remaining = stopAt - clock();
      const finished = await settlesWithin(syncOne(m), Math.max(0, remaining));
      if (!finished) {
        summary.timedOut += 1;
        summary.perGame.push({ match: m.id, skipped: 'timed-out' });
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, live.length)) }, worker));

  summary.skippedForBudget = live.length - next;
  summary.gamesCalls = games.calls();
  summary.calls = summary.gamesCalls + summary.statsCalls;
  summary.elapsedMs = clock() - startedAt;
  summary.unmapped = [...new Set(summary.unmapped)];
  return summary;
}
