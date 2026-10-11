// lib/draftGame/create.js - one per-game Draft board per real game (thu-3 S1).
//
// game_type 'draft_game', keyed by match_id (migration 136: UNIQUE (game_type,
// match_id)), so a double fire, a race or a re-run can never make a second
// board for one game - the INSERT is ON CONFLICT DO NOTHING against that index,
// the ensurePickemBoard pattern.
//
// WHEN. A board opens OPEN_HOURS before its kickoff and the hourly cron
// (/api/cron/draft-game-board) creates every board whose open has arrived and
// whose game has not kicked. A missed hour is made up by the next one; a game
// already under way gets no board.
//
// LOCK = KICKOFF. locks_at is the match's kickoff at creation and the same cron
// re-reads it for every open board, so a game that moves takes its lock with
// it. The room itself checks the LIVE match row (rules.gameLocked), so a lock
// never waits for the cron.
//
// NFL (S1) AND NBA (S3) - SPORTS below; CFB (S5, final-only) adds a pool builder;
// the row shape does not change. Nothing settles a 'draft_game' yet (S2) -
// settles_at is the scheduled end, and settleDue is game_type-scoped, so no
// existing settler can pick these rows up.

import { sql as defaultSql } from '../db.js';
import { buildNflPool, POOL_MIN } from './pool.js';
import { buildNbaPool } from './nbaPool.js';
import { SEATS, ROUNDS, COUNT_BEST, CLOCK_SECONDS } from './rules.js';

export const GAME_TYPE = 'draft_game';
export const OPEN_HOURS = 72;

/**
 * THE SPORTS (mon-1 S3 adds NBA). Each has its league, how long before tip a
 * board opens, its pool builder, and the first day it may have boards.
 *   NFL: 72 h - a Sunday slate opens Thursday night.
 *   NBA: 24 h - a nightly slate; boards from opening night, 20 Oct 2026.
 * NBA matches carry no week, and a match-keyed contest still needs one for
 * contests_key_shape (migration 112), so an NBA board stores week 0 - it sits
 * outside idx_contests_week (136) and nothing reads its week.
 */
export const SPORTS = Object.freeze({
  nfl: Object.freeze({ league: 'nfl', openHours: 72, buildPool: buildNflPool, from: null }),
  nba: Object.freeze({ league: 'nba', openHours: 24, buildPool: buildNbaPool, from: '2026-10-20T00:00:00Z' }),
});
/** A football game is over well inside this; S2's settle gates on the final, not on this. */
export const SETTLE_AFTER_HOURS = 5;
const H = 3_600_000;

/**
 * The NFL games whose board should exist now: scheduled, kickoff in
 * (now, now + OPEN_HOURS], no board yet, kickoff a real time (never a TBD
 * placeholder). Read-only. `leagueSlug` is for tests (a fixture league), never
 * another sport - S3/S5 bring their own pool builders.
 */
export async function dueNflGames({ now = new Date(), sql = defaultSql, leagueSlug = 'nfl' } = {}) {
  return dueGames({ now, sql, leagueSlug, openHours: OPEN_HOURS });
}

/** Any sport's due games (see dueNflGames); `from` is the first kickoff that may have a board. */
export async function dueGames({ now = new Date(), sql = defaultSql, leagueSlug, openHours, from = null } = {}) {
  const lo = new Date(Math.max(new Date(now).getTime(), from ? new Date(from).getTime() : 0)).toISOString();
  const hi = new Date(new Date(now).getTime() + openHours * H).toISOString();
  return sql`
    SELECT m.id, m.slug, m.kickoff_at, m.status, m.season_year, m.week, m.season_phase,
           m.home_team_id, m.away_team_id, th.abbreviation AS home, ta.abbreviation AS away
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      JOIN teams th ON th.id = m.home_team_id
      JOIN teams ta ON ta.id = m.away_team_id
     WHERE l.slug = ${leagueSlug} AND m.status = 'scheduled'
       AND m.kickoff_at > ${lo} AND m.kickoff_at <= ${hi}
       AND m.season_year IS NOT NULL
       AND NOT COALESCE((m.metadata->>'kickoff_tbd')::boolean, false)
       AND NOT EXISTS (SELECT 1 FROM contests c WHERE c.game_type = ${GAME_TYPE} AND c.match_id = m.id)
     ORDER BY m.kickoff_at, m.id`;
}

/** Create one game's board. Returns { created, id?, reason?, poolSize? }. */
export async function createGameBoard(match, { now = new Date(), sql = defaultSql, sport = 'nfl', buildPool = SPORTS[sport].buildPool } = {}) {
  const pool = await buildPool(match, { sql });
  if (pool.length < POOL_MIN) return { created: false, matchId: match.id, reason: 'pool_too_small', poolSize: pool.length };
  const kickoff = new Date(match.kickoff_at);
  const opensAt = new Date(Math.min(new Date(now).getTime(), kickoff.getTime()));
  const meta = {
    slug: match.slug, home: match.home, away: match.away, sport,
    seats: SEATS, rounds: ROUNDS, count: COUNT_BEST, clock_s: CLOCK_SECONDS,
  };
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, match_id, board, opens_at, locks_at, settles_at, meta)
    VALUES (${GAME_TYPE}, ${sport}, ${match.season_year}, ${match.week ?? 0}, ${match.id},
            ${JSON.stringify(pool)}::jsonb, ${opensAt.toISOString()}, ${kickoff.toISOString()},
            ${new Date(kickoff.getTime() + SETTLE_AFTER_HOURS * H).toISOString()}, ${JSON.stringify(meta)}::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  if (!r.length) {
    const [again] = await sql`SELECT id FROM contests WHERE game_type = ${GAME_TYPE} AND match_id = ${match.id}`;
    return { created: false, matchId: match.id, id: again?.id ?? null, reason: 'raced' };
  }
  return { created: true, matchId: match.id, id: r[0].id, poolSize: pool.length };
}

/**
 * Keep every OPEN board's lock on its game's current kickoff (a moved game takes
 * its lock along). Only boards not yet locked are touched. Returns the count moved.
 */
export async function refreshLocks({ now = new Date(), sql = defaultSql } = {}) {
  const r = await sql`
    UPDATE contests c
       SET locks_at = m.kickoff_at,
           settles_at = m.kickoff_at + make_interval(hours => ${SETTLE_AFTER_HOURS})
      FROM matches m
     WHERE c.game_type = ${GAME_TYPE} AND c.match_id = m.id AND NOT c.settled
       AND c.locks_at > ${new Date(now).toISOString()} AND c.locks_at <> m.kickoff_at
    RETURNING c.id`;
  return r.length;
}

/**
 * THE SWITCH (fri-1): boards are made only while DRAFT_GAME_BOARDS is 'on'.
 * Anything else - 'off', unset, a typo - makes nothing, so a deploy that
 * forgets the variable cannot open boards before S2 can settle them.
 */
export const boardsEnabled = (env = process.env) => String(env.DRAFT_GAME_BOARDS ?? '').trim().toLowerCase() === 'on';

/**
 * NBA'S OWN SWITCH (sat-2): DRAFT_GAME_NBA, read ALONGSIDE the master switch -
 * NBA boards need both 'on'. NFL boards ignore it. Same strictness: anything but
 * 'on' is off, so a forgotten variable keeps NBA dark.
 */
export const nbaEnabled = (env = process.env) => boardsEnabled(env) && String(env.DRAFT_GAME_NBA ?? '').trim().toLowerCase() === 'on';

/** The sports whose boards the hourly run makes, given the env. PURE. */
export function enabledSports(env = process.env) {
  if (!boardsEnabled(env)) return [];
  return Object.keys(SPORTS).filter((s) => s !== 'nba' || nbaEnabled(env));
}

/** The hourly run: create what is due, then move any lock whose game moved. */
export async function ensureGameBoards({ now = new Date(), sql = defaultSql, env = process.env } = {}) {
  if (!boardsEnabled(env)) return { disabled: true, due: 0, created: 0, refused: [], raced: 0, locksMoved: 0 };
  // ONE SPORT'S FAILURE NEVER COSTS THE OTHER: an NBA roster fetch that throws
  // (BDL down) is recorded and the NFL boards are still made, and vice versa.
  const bySport = {};
  const results = [];
  let due = 0;
  for (const sport of Object.keys(SPORTS)) {
    const cfg = SPORTS[sport];
    if (!enabledSports(env).includes(sport)) { bySport[sport] = { disabled: true }; continue; }
    try {
      const games = await dueGames({ now, sql, leagueSlug: cfg.league, openHours: cfg.openHours, from: cfg.from });
      due += games.length;
      const rs = [];
      for (const m of games) {
        try { rs.push(await createGameBoard(m, { now, sql, sport })); }
        catch (e) { rs.push({ created: false, matchId: m.id, reason: 'error', error: String(e?.message ?? e).slice(0, 200) }); }
      }
      results.push(...rs);
      bySport[sport] = { due: games.length, created: rs.filter((r) => r.created).length, errors: rs.filter((r) => r.reason === 'error').length };
    } catch (e) {
      bySport[sport] = { error: String(e?.message ?? e).slice(0, 200) };
    }
  }
  const moved = await refreshLocks({ now, sql });
  return {
    due,
    created: results.filter((r) => r.created).length,
    refused: results.filter((r) => r.reason === 'pool_too_small').map((r) => ({ matchId: r.matchId, poolSize: r.poolSize })),
    raced: results.filter((r) => r.reason === 'raced').length,
    errors: results.filter((r) => r.reason === 'error').map((r) => ({ matchId: r.matchId, error: r.error })),
    locksMoved: moved,
    bySport,
  };
}
