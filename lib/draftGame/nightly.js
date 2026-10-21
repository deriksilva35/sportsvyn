// lib/draftGame/nightly.js - THE NBA NIGHTLY DRAFT (tue-6): one room over the
// night's NBA slate, on the per-game Draft's engine.
//
// THE SLATE IS THE NIGHT'S GAMES THAT HAVE NOT TIPPED WHEN THE ROOM OPENS: NBA
// matches on today's ET date, status 'scheduled', tip after `now`. The room is
// made once per ET night (meta.day_et), the first time the hourly board run sees
// NBA_NIGHTLY_DRAFT on and a slate of at least MIN_GAMES.
//
// IT IS A draft_game CONTEST like any other, so the room, the clock, the bots,
// the reads and the settle are lib/draftGame's. What differs lives on meta:
//   nightly: true, day_et, slate: [match ids], games: [{ id, slug, home, away, tip }]
//   seats, rounds, slots, count - the ROOM SHAPE (rules.shapeOf)
// match_id is the slate's FIRST game, so the lock is the first tip
// (rules.gameLocked, create.refreshLocks follow it) and the settle waits for the
// LAST game (settle.js reads meta.slate).
//
// THE POOL is both clubs of every slate game (nbaPool.buildNbaPool per game),
// each row carrying its opponent and tip so the room can say "vs NYK · 4:00 PM PT".
// A POSITIONAL CHECK refuses a pool that cannot fill every seat's slots.

import { sql as defaultSql } from '../db.js';
import { etDate } from '../leagues/weeks.js';
import { GAME_TYPE } from './create.js';
import { buildNbaPool } from './nbaPool.js';
import { CLOCK_SECONDS, slotFits } from './rules.js';
import { espnFppg } from '../nba/fantasyPoints.js';

export const MIN_GAMES = 2;
const H = 3_600_000;

/** NBA_NIGHTLY_DRAFT - anything but 'on' is off. */
export const nightlyEnabled = (env = process.env) => String(env.NBA_NIGHTLY_DRAFT ?? '').trim().toLowerCase() === 'on';

/**
 * The room's shape for a slate of `games`. Two games: four drafters, three
 * picks, G · F · UTIL, all three count. (Bigger slates take the same shape
 * until the larger room sizes are built.)
 */
export function nightlyShape(games) {
  void games;
  return { seats: 4, rounds: 3, slots: ['G', 'F', 'UTIL'], count: 3 };
}

/**
 * Can this pool fill every seat? Each slot type needs at least seats + 2
 * eligible players (a margin for the bots' taste), and the pool the whole
 * draft plus four. PURE. -> { ok, reason? }
 */
export function poolFits(pool, shape) {
  const need = shape.seats * shape.rounds + 4;
  if (pool.length < need) return { ok: false, reason: `pool ${pool.length} < ${need}` };
  for (const slot of new Set(shape.slots ?? [])) {
    if (slot === 'UTIL') continue;
    const per = shape.slots.filter((s) => s === slot).length;
    const n = pool.filter((p) => slotFits(p.pos, slot)).length;
    if (n < shape.seats * per + 2) return { ok: false, reason: `${slot} ${n} < ${shape.seats * per + 2}` };
  }
  return { ok: true };
}

/** Tonight's untipped NBA games, first tip first. Read-only. */
export async function nightSlate({ now = new Date(), sql = defaultSql } = {}) {
  const day = etDate(new Date(now));
  const rows = await sql`
    SELECT m.id, m.slug, m.kickoff_at, m.status, m.season_year, m.week,
           m.home_team_id, m.away_team_id, th.abbreviation AS home, ta.abbreviation AS away
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      JOIN teams th ON th.id = m.home_team_id
      JOIN teams ta ON ta.id = m.away_team_id
     WHERE l.slug = 'nba' AND m.status = 'scheduled'
       AND m.kickoff_at > ${new Date(now).toISOString()}
       AND m.kickoff_at < ${new Date(new Date(now).getTime() + 30 * H).toISOString()}
     ORDER BY m.kickoff_at, m.id`;
  return { day, games: rows.filter((m) => etDate(new Date(m.kickoff_at)) === day) };
}

/** Tag a game's pool rows with where they play: opponent, home/away, tip. PURE. */
export function tagRows(rows, m) {
  return rows.map((r) => {
    const home = r.team === m.home;
    return { ...r, match_id: Number(m.id), opp: home ? m.away : m.home, home, tip: new Date(m.kickoff_at).toISOString() };
  });
}

/** Tonight's room, if any: the nightly contest for an ET day. */
export async function nightlyContest(day, { sql = defaultSql } = {}) {
  const [c] = await sql`
    SELECT id, locks_at, settled, meta FROM contests
     WHERE game_type = ${GAME_TYPE} AND sport = 'nba' AND meta->>'nightly' = 'true' AND meta->>'day_et' = ${day}
     ORDER BY id LIMIT 1`;
  return c ?? null;
}

/**
 * Make tonight's room if it is due. -> { created, id?, reason?, ... }.
 * Idempotent: one room per ET night.
 */
export async function ensureNightlyNba({ now = new Date(), sql = defaultSql, env = process.env, buildPool = buildNbaPool } = {}) {
  if (!nightlyEnabled(env)) return { created: false, reason: 'off' };
  const { day, games } = await nightSlate({ now, sql });
  const have = await nightlyContest(day, { sql });
  if (have) return { created: false, reason: 'exists', id: have.id, day };
  if (games.length < MIN_GAMES) return { created: false, reason: 'small_slate', day, games: games.length };
  const shape = nightlyShape(games.length);
  const pool = [];
  // ESPN POINTS: the avg on every row and the settle both use ESPN's table.
  for (const m of games) pool.push(...tagRows(await buildPool(m, { sql, project: espnFppg }), m));
  const fit = poolFits(pool, shape);
  if (!fit.ok) return { created: false, reason: 'pool', detail: fit.reason, day, games: games.length };
  const first = games[0];
  const last = games[games.length - 1];
  const meta = {
    nightly: true, day_et: day, sport: 'nba', slug: `nba-nightly-${day}`,
    slate: games.map((g) => Number(g.id)),
    games: games.map((g) => ({ id: Number(g.id), slug: g.slug, home: g.home, away: g.away, tip: new Date(g.kickoff_at).toISOString() })),
    ...shape, clock_s: CLOCK_SECONDS, scoring: 'espn',
  };
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, match_id, board, opens_at, locks_at, settles_at, meta)
    VALUES (${GAME_TYPE}, 'nba', ${first.season_year}, ${first.week ?? 0}, ${first.id},
            ${JSON.stringify(pool)}::jsonb, ${new Date(now).toISOString()}, ${new Date(first.kickoff_at).toISOString()},
            ${new Date(new Date(last.kickoff_at).getTime() + 3 * H).toISOString()}, ${JSON.stringify(meta)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) return { created: false, reason: 'raced', day };
  return { created: true, id: r[0].id, day, games: games.length, poolSize: pool.length };
}
