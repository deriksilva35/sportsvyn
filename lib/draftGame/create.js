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
// S1 IS NFL ONLY. NBA (S3) and CFB (S5, final-only) add a pool builder each;
// the row shape does not change. Nothing settles a 'draft_game' yet (S2) -
// settles_at is the scheduled end, and settleDue is game_type-scoped, so no
// existing settler can pick these rows up.

import { sql as defaultSql } from '../db.js';
import { buildNflPool, POOL_MIN } from './pool.js';
import { SEATS, ROUNDS, COUNT_BEST, CLOCK_SECONDS } from './rules.js';

export const GAME_TYPE = 'draft_game';
export const OPEN_HOURS = 72;
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
  const lo = new Date(now).toISOString();
  const hi = new Date(new Date(now).getTime() + OPEN_HOURS * H).toISOString();
  return sql`
    SELECT m.id, m.slug, m.kickoff_at, m.status, m.season_year, m.week, m.season_phase,
           m.home_team_id, m.away_team_id, th.abbreviation AS home, ta.abbreviation AS away
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      JOIN teams th ON th.id = m.home_team_id
      JOIN teams ta ON ta.id = m.away_team_id
     WHERE l.slug = ${leagueSlug} AND m.status = 'scheduled'
       AND m.kickoff_at > ${lo} AND m.kickoff_at <= ${hi}
       AND m.season_year IS NOT NULL AND m.week IS NOT NULL
       AND NOT COALESCE((m.metadata->>'kickoff_tbd')::boolean, false)
       AND NOT EXISTS (SELECT 1 FROM contests c WHERE c.game_type = ${GAME_TYPE} AND c.match_id = m.id)
     ORDER BY m.kickoff_at, m.id`;
}

/** Create one game's board. Returns { created, id?, reason?, poolSize? }. */
export async function createGameBoard(match, { now = new Date(), sql = defaultSql, buildPool = buildNflPool } = {}) {
  const pool = await buildPool(match, { sql });
  if (pool.length < POOL_MIN) return { created: false, matchId: match.id, reason: 'pool_too_small', poolSize: pool.length };
  const kickoff = new Date(match.kickoff_at);
  const opensAt = new Date(Math.min(new Date(now).getTime(), kickoff.getTime()));
  const meta = {
    slug: match.slug, home: match.home, away: match.away,
    seats: SEATS, rounds: ROUNDS, count: COUNT_BEST, clock_s: CLOCK_SECONDS,
  };
  const r = await sql`
    INSERT INTO contests (game_type, sport, season_year, week, match_id, board, opens_at, locks_at, settles_at, meta)
    VALUES (${GAME_TYPE}, 'nfl', ${match.season_year}, ${match.week}, ${match.id},
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

/** The hourly run: create what is due, then move any lock whose game moved. */
export async function ensureGameBoards({ now = new Date(), sql = defaultSql, env = process.env } = {}) {
  if (!boardsEnabled(env)) return { disabled: true, due: 0, created: 0, refused: [], raced: 0, locksMoved: 0 };
  const due = await dueNflGames({ now, sql });
  const results = [];
  for (const m of due) results.push(await createGameBoard(m, { now, sql }));
  const moved = await refreshLocks({ now, sql });
  return {
    due: due.length,
    created: results.filter((r) => r.created).length,
    refused: results.filter((r) => r.reason === 'pool_too_small').map((r) => ({ matchId: r.matchId, poolSize: r.poolSize })),
    raced: results.filter((r) => r.reason === 'raced').length,
    locksMoved: moved,
  };
}
