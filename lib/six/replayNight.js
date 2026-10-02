// lib/six/replayNight.js - a whole recorded NBA NIGHT through the real poller,
// on DEV, for Tonight's Six.
//
// lib/nba/replayRun.js replays games one at a time, each on its own clock -
// right for proving the poller, wrong for a nightly card, whose whole point is
// several games at once: one final while one is live and one has not tipped.
// This drives every game of a night on ONE clock through the same pollOnce,
// with the NBA registry's own hooks and the live loop's box cadence
// (StatsTracker -> syncNbaGameStats), exactly as services/live-poller does.
//
// THE NIGHT IS REAL: 5 Mar 2026 (2025-26), three of its games recorded from
// BDL - DAL @ ORL 114-115 (00:00Z), GSW @ HOU 115-113 in OVERTIME (00:30Z) and
// LAL @ DEN 113-120 (03:00Z). Stephen Curry is in the GSW @ HOU box with no
// minutes: picked before the tip, he is the LATE SCRATCH.
//
// SHIFTED, NOT EDITED. The recordings are moved in time (and their provider ids
// offset) so they can never collide with lib/nba/replay.test.mjs, which files
// the same two games under their real ids on the same DEV - a partial unique
// index on (league_id, bdl_game_id) would refuse the second, and one run's
// poller would write the other's rows. Every play keeps its gaps; only the
// origin moves. `date` is recomputed as the ET day of the shifted tip, which is
// what BDL files a game under.
//
// THE RECORDER'S ONE LIMIT, inherited (lib/nba/replay.js): /stats serves the
// FINAL box at any instant, so a live game's chips show its final line.
//
// DEV ONLY. Sentinel slugs `sentinel-six-<id>`; scripts/dev-orphan-sweep.mjs
// lists `^sentinel-` should a killed run leave one.

import { pollOnce, nbaDay, fromNba, nbaDetail, nbaKickoff, writeNbaDetail } from '../../services/live-poller/poll.mjs';
import { StatsTracker } from '../live/statsCadence.js';
import { syncNbaGameStats, syncNbaLastPlay } from '../nba/statsSync.js';
import { loadReplay, replayFetch, replaySpan } from '../nba/replay.js';
import { etDay } from '../nba/dayPickem.js';

export const SIX_PREFIX = 'sentinel-six-';
export const SIX_NIGHT = Object.freeze({
  day: '2026-03-05',
  ids: Object.freeze(['18447717', '18447720', '18447724']),
  ot: '18447720',
  lateScratch: Object.freeze({ game: '18447720', name: 'Stephen Curry' }),
});

/** PURE. A recording moved by `ms` with its provider id offset by `idOffset`. */
export function shiftFixture(fx, { ms = 0, idOffset = 0 } = {}) {
  const at = (iso) => (iso ? new Date(Date.parse(iso) + ms).toISOString() : iso);
  const datetime = at(fx.game.datetime);
  return {
    ...fx,
    game: { ...fx.game, id: Number(fx.game.id) + idOffset, datetime, date: etDay(datetime), status: fx.game.status === 'Final' ? 'Final' : at(fx.game.status) },
    plays: fx.plays.map((p) => ({ ...p, wallclock: at(p.wallclock) })),
    stats: fx.stats,
    recordedId: String(fx.game.id),
  };
}

/** Load the night's recordings, shifted. */
export function nightFixtures({ ids = SIX_NIGHT.ids, ms = 0, idOffset = 0, perGame = {} } = {}) {
  return ids.map((id) => shiftFixture(loadReplay(id), { ms: ms + (perGame[id] ?? 0), idOffset }));
}

/** File one sentinel match per recording, at its (shifted) tip, scheduled. */
export async function seedNight(sql, fixtures) {
  if (process.env.PROD_DATABASE_URL && process.env.DATABASE_URL === process.env.PROD_DATABASE_URL) {
    throw new Error('seedNight refuses: DATABASE_URL is PROD');
  }
  const [league] = await sql`SELECT id FROM leagues WHERE slug = 'nba'`;
  if (!league) throw new Error('no nba league on this database');
  const out = [];
  for (const fx of fixtures) {
    const g = fx.game;
    const teams = await sql`
      SELECT id, external_ids->>'bdl_team_id' AS pid FROM teams
       WHERE league_id = ${league.id} AND external_ids->>'bdl_team_id' = ANY(${[String(g.home_team.id), String(g.visitor_team.id)]})`;
    const tid = new Map(teams.map((t) => [t.pid, t.id]));
    const slug = `${SIX_PREFIX}${g.id}`;
    await sql`DELETE FROM matches WHERE slug = ${slug}`;
    const [m] = await sql`
      INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status,
                           season_year, season_phase, metadata, external_ids, created_at, updated_at)
      VALUES (${league.id}, ${slug}, ${tid.get(String(g.home_team.id))}, ${tid.get(String(g.visitor_team.id))},
              ${g.datetime}, 'scheduled', ${g.season}, 'REG', '{}'::jsonb,
              ${JSON.stringify({ bdl_game_id: String(g.id) })}::jsonb, now(), now())
      RETURNING id`;
    out.push({ fx, matchId: m.id, homeTeamId: tid.get(String(g.home_team.id)), awayTeamId: tid.get(String(g.visitor_team.id)) });
  }
  return out;
}

/**
 * Drive the night's clock from `from` to `to` (ms), one pollOnce a step over
 * every game, with the live loop's box cadence. Resumable: pass the returned
 * `state` back to continue from where it stopped (the StatsTracker remembers
 * which games it saw live, as the long-running poller does).
 */
export async function driveNight(sql, seeded, { from, to, stepSec = 30, state = null, log = () => {} } = {}) {
  const fixtures = seeded.map((s) => s.fx);
  const st = state ?? { t: from, polls: 0, livePolls: 0, stats: new StatsTracker(), events: [] };
  let t = st.t;
  const fetchImpl = replayFetch(fixtures, () => t);
  const dispatchFn = async (_sql, { event, state: s }) => { st.events.push({ event, period: s?.period ?? null, at: new Date(t).toISOString() }); return { sent: 0, skipped: 0, failed: 0 }; };
  const ids = seeded.map((s) => s.matchId);
  for (; t <= to; t += stepSec * 1000) {
    const now = new Date(t);
    await pollOnce(sql, {
      league: 'nba', providerKey: 'bdl_game_id',
      fetcher: () => nbaDay(now, { fetchImpl, key: 'replay' })(),
      normalise: fromNba, detail: nbaDetail, writeDetail: writeNbaDetail, kickoffOf: nbaKickoff,
      futureMinutes: 30, now, dispatchFn, log,
    });
    st.polls += 1;
    const rows = await sql`SELECT id, status FROM matches WHERE id = ANY(${ids})`;
    if (rows.some((r) => r.status === 'live')) st.livePolls += 1;
    for (const d of st.stats.due({ polls: st.livePolls, matches: rows.map((r) => ({ id: r.id, status: r.status })) })) {
      await syncNbaGameStats(d.id, { sql, fetchImpl, key: 'replay' });
      await syncNbaLastPlay(d.id, { sql, fetchImpl, key: 'replay' });
    }
  }
  st.t = t;
  return st;
}

/** The instants a test steers by, per recording. PURE. */
export function spans(seeded) {
  return Object.fromEntries(seeded.map((s) => [s.fx.recordedId, { ...replaySpan(s.fx), matchId: s.matchId }]));
}

/** Delete the night's sentinel matches (stats cascade). */
export async function teardownNight(sql, seeded) {
  const ids = seeded.map((s) => s.matchId);
  if (ids.length) await sql`DELETE FROM matches WHERE id = ANY(${ids})`;
}

/**
 * A fetch() for the POOL's three routes, served from the night's own boxes, so
 * the pool a replay card is picked from is the players who were actually
 * dressed that night (today's BDL rosters are a different season's).
 *   /nba/v1/players/active          every player in the night's boxes
 *   /nba/v1/player_injuries         `injuries` ({ bdl player id: status })
 *   /nba/v1/season_averages/general `averages(path)` when given (a real fetch,
 *                                   read-only, for shots), else empty
 */
export function poolFetch(fixtures, { injuries = {}, averages = null } = {}) {
  const players = new Map();
  for (const fx of fixtures) {
    for (const s of fx.stats) {
      const p = s.player; if (p?.id == null) continue;
      players.set(String(p.id), { id: p.id, first_name: p.first_name, last_name: p.last_name, position: p.position, team: { id: s.team?.id } });
    }
  }
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  return async (url, init) => {
    const u = new URL(url);
    if (u.pathname === '/nba/v1/players/active') {
      const want = new Set(u.searchParams.getAll('team_ids[]').map(String));
      return json({ data: [...players.values()].filter((p) => want.has(String(p.team.id))), meta: { per_page: 100 } });
    }
    if (u.pathname === '/nba/v1/player_injuries') {
      return json({ data: Object.entries(injuries).filter(([id]) => players.has(id)).map(([id, status]) => ({ player: { ...players.get(id) }, status })), meta: { per_page: 100 } });
    }
    if (u.pathname === '/nba/v1/season_averages/general') {
      if (averages) return averages(url, init);
      return json({ data: [], meta: { per_page: 100 } });
    }
    return { ok: false, status: 404, json: async () => ({ error: 'Route not found' }) };
  };
}
