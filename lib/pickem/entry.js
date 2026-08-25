// lib/pickem/entry.js - the Pick 'em board against the database.
//
// SEALED PER-GAME: the wire payload carries the VIEWER'S picks and nobody
// else's - the reveal of the field is per-game and belongs to Relay 3's
// field data; until then no other player's side ever leaves the server.
// Pinned by leak test with a planted second entry as the negative control.
//
// THE SAVE IS WHERE THE LOCK LIVES. The GAME's snapshot kickoff against the
// SERVER clock is the only authority - no client clock is trusted, the
// OS-outranks-column law's cousin. A save for a kicked game is rejected with
// a kind error naming the lock, whatever the client believed.

import { sql } from '../db.js';
import { gameRows, progressOf, recordOf, nextKickoff, boardPhase } from './view.js';

/** The board the route serves: the newest opened pickem contest, settled or
 * not (the receipt needs the settled one); null before board 1 exists. */
export async function currentPickemBoard({ now = new Date() } = {}) {
  const r = await sql`
    SELECT id, sport, season_year, week, board, opens_at, locks_at, settled, settled_at, meta
      FROM contests
     WHERE game_type = 'pickem' AND opens_at <= ${new Date(now).toISOString()}
     ORDER BY opens_at DESC LIMIT 1`;
  return r[0] ?? null;
}

/** MY flat lineup for a contest - {} when I have no entry yet. */
async function myPicks(contestId, userId) {
  if (userId == null) return {};
  const r = await sql`
    SELECT lineup FROM contest_entries
     WHERE contest_id = ${contestId} AND user_id = ${userId} LIMIT 1`;
  return r[0]?.lineup ?? {};
}

/** Live status + scores for the board's games - display only; deadlines stay
 * with the snapshot. */
async function liveGames(board) {
  const ids = board.map((g) => g.match_id);
  const rows = await sql`
    SELECT id, status, home_score, away_score FROM matches WHERE id = ANY(${ids})`;
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Everything /pickem renders, viewer-scoped. Phase 'preopen' (which covers
 * "no board yet") carries no games at all.
 */
export async function pickemBoardView(userId, { now = new Date() } = {}) {
  const contest = await currentPickemBoard({ now }).catch(() => null);
  const phase = boardPhase(contest, now);
  if (!contest || phase === 'preopen') return { phase: 'preopen', contest: null, games: [] };

  const [liveById, picks] = await Promise.all([
    liveGames(contest.board),
    myPicks(contest.id, userId),
  ]);
  // AP ranks for the board's teams - one query for the whole board, resolved
  // server-side so the client never needs a rankings table of its own.
  const { apRankMap, currentApWeek, latestPollSeason, AP_POLL } = await import('../cfb/rankings.js');
  const apSeason = contest.sport === 'cfb' ? await latestPollSeason(AP_POLL) : null;
  const apWeek = apSeason ? await currentApWeek(apSeason) : null;
  const apRanks = apWeek ? await apRankMap({ season: apSeason, week: apWeek }) : new Map();
  const games = gameRows({ board: contest.board, liveById, picks, now, apRanks });
  // The receipt's field facts ride only the settled phase - null otherwise
  // and null for a stranger; receiptFor re-checks `settled` itself.
  const receipt = phase === 'settled'
    ? await receiptFor(contest.id, userId, {
      results: contest.perfect?.results ?? null,
      board: contest.board,
    }).catch(() => null)
    : null;
  return {
    phase,
    receipt,
    contest: {
      id: contest.id,
      sport: contest.sport,
      week: contest.week,
      gamesCount: contest.board.length,
      opensAt: contest.opens_at,
      locksAt: contest.locks_at,
      settled: contest.settled,
    },
    games,
    progress: progressOf(games),
    record: recordOf(games),
    nextKickoff: nextKickoff(games),
  };
}

/**
 * The settled receipt's FIELD facts - rank and rarest correct pick. POST-
 * SETTLE ONLY, enforced here: before `settled` the field's picks are sealed
 * per game and this returns null without touching entries. After settle every
 * game is final, the per-game reveal condition is met for the whole board,
 * and the aggregate (counts, never named picks) is the only thing served.
 */
export async function receiptFor(contestId, userId, { results, board }) {
  const c = (await sql`
    SELECT settled FROM contests WHERE id = ${contestId} AND game_type = 'pickem' LIMIT 1`)[0];
  if (!c?.settled || userId == null) return null;
  const entries = await sql`
    SELECT user_id, score, lineup FROM contest_entries WHERE contest_id = ${contestId}`;
  const mine = entries.find((e) => e.user_id === userId);
  if (!mine) return null;
  const field = entries.length;
  const rank = 1 + entries.filter((e) => Number(e.score ?? 0) > Number(mine.score ?? 0)).length;
  // Rarest correct pick: among MY wins, the side the fewest entrants shared.
  let best = null;
  for (const [matchId, side] of Object.entries(mine.lineup ?? {})) {
    if (results?.[matchId] !== side) continue;
    const same = entries.filter((e) => (e.lineup ?? {})[matchId] === side).length;
    if (!best || same < best.same) {
      const g = board.find((x) => String(x.match_id) === matchId);
      best = { name: side === 'home' ? g?.home : g?.away, same, pct: Math.round((same / field) * 100) };
    }
  }
  return { score: Number(mine.score ?? 0), rank, field, best };
}

/**
 * The lobby card's one-line summary - viewer-scoped or null. Null (caught or
 * genuine) reads as "no live board" and the card stays ghosted, the lobby's
 * safe direction.
 */
export async function pickemCardData(userId, { now = new Date() } = {}) {
  const contest = await currentPickemBoard({ now });
  if (!contest || contest.settled) return null;
  const picks = userId == null ? {} : await myPicks(contest.id, userId);
  const total = contest.board.length;
  const picked = Object.keys(picks).length;
  const t = new Date(now).getTime();
  const next = contest.board.find((g) => new Date(g.kickoff_at).getTime() > t) ?? null;
  return { total, picked, nextKickoff: next?.kickoff_at ?? null, entered: picked > 0 };
}

/**
 * Save one pick. Returns { ok:true, matchId, side } or { ok:false, reason }.
 * Reasons are KIND and specific: 'game_locked' names the per-game seal.
 */
export async function savePick(userId, contestId, matchId, side, { now = new Date() } = {}) {
  if (!['home', 'away'].includes(side)) return { ok: false, reason: 'bad_side' };
  const contest = (await sql`
    SELECT id, board, settled, opens_at FROM contests
     WHERE id = ${contestId} AND game_type = 'pickem' LIMIT 1`)[0];
  if (!contest) return { ok: false, reason: 'no_board' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  const t = new Date(now).getTime();
  if (new Date(contest.opens_at).getTime() > t) return { ok: false, reason: 'not_open' };

  const game = contest.board.find((g) => Number(g.match_id) === Number(matchId));
  if (!game) return { ok: false, reason: 'not_on_board' };
  // THE PER-GAME LOCK: the snapshot kickoff, `<=` at the boundary. A game
  // that has kicked is sealed however the request found its way here.
  if (new Date(game.kickoff_at).getTime() <= t) {
    return { ok: false, reason: 'game_locked', kickoffAt: game.kickoff_at };
  }

  // lineup is a FLAT map {match_id: side} - the top-level merge is the one
  // place jsonb || is honest (the shallow-merge law: never on nesting; there
  // is no nesting here by construction).
  const patch = JSON.stringify({ [String(game.match_id)]: side });
  await sql`
    INSERT INTO contest_entries (contest_id, user_id, lineup)
    VALUES (${contestId}, ${userId}, ${patch}::jsonb)
    ON CONFLICT (contest_id, user_id)
    DO UPDATE SET lineup = contest_entries.lineup || ${patch}::jsonb, updated_at = now()`;
  return { ok: true, matchId: game.match_id, side };
}
