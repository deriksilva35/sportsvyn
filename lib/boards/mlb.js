// lib/boards/mlb.js - October and The Run, live: the standing as it is NOW.
//
// THE BOARDS ALREADY EXISTED AND ONLY COUNTED WHAT HAD SETTLED. /october/board
// summed settled days and /run/board settled rounds; everything in play printed
// a dash or "set" until an hourly cron closed the day or the round - and
// October had no cron at all (see app/api/cron/october-settle). The live part
// was already written, it just only ever ran for the reader's own card: October's
// scoreCard and The Run's scoreRoster, both PURE, both fed by the same box scores
// the settle reads. This module runs them for every entry.
//
// LIVE IS ADDED, SETTLED IS NOT RECOMPUTED. A settled day or round keeps the
// settle's score (the ruling, DNF included); an unsettled one contributes its
// live sum. Once it settles the two are the same number, so the standing does
// not jump at the moment of settlement - unless the settle rules a DNF, which
// is the settle's call to make and the board's to show.
//
// COMPETITION RANK, as the NFL boards: equal totals share a place, listed
// earliest submission first (lib/games/rank.js). The old boards numbered by
// position, which put two players on 187.0 in 3rd and 4th.
//
// EVERY ROW, NOT FIFTY. Both old readers sliced to 50 before the page looked
// for the reader, so anybody 51st or lower read "not entered". The page slices
// for display; the reader is found in the whole standing.

import { sql } from '../db.js';
import { round1 } from '../mlb/fantasyPoints.js';
import { octoberBoard } from '../october/board.js';
import { scoreCard, boxFor } from '../october/settle.js';
import { runBoard } from '../run/board.js';
import { scoreRoster, boxForRound } from '../run/settle.js';
import { ROUNDS } from '../run/rules.js';
import { standingsAt, MOVEMENT_MIN } from './live.js';
import { rankRows, withMovement } from './view.js';

const ALL = Number.MAX_SAFE_INTEGER;

/** The unsettled contests of one MLB game, for one tournament (preview or not). */
async function openContests(gameType, season, preview) {
  return sql`
    SELECT * FROM contests
     WHERE game_type = ${gameType} AND sport = 'mlb' AND season_year = ${season} AND NOT settled
       AND COALESCE((meta->>'preview')::boolean, false) = ${preview}
     ORDER BY puzzle_date ASC NULLS LAST, week ASC NULLS LAST`;
}

/** userId -> lineup for one contest. */
async function lineupsOf(contestId) {
  const r = await sql`SELECT user_id, lineup FROM contest_entries WHERE contest_id = ${contestId}`;
  return new Map(r.map((x) => [x.user_id, x.lineup ?? {}]));
}

/**
 * PURE. Fold live points into an old-shape standing and re-rank.
 * live: Map(userId -> { points, state }) - the open day's / round's live sums.
 */
export function withLive(rows = [], live = new Map(), key = 'live') {
  return rankRows(rows.map((r) => {
    const l = live.get(r.userId) ?? null;
    const points = round1((Number(r.total) || 0) + (l?.points ?? 0));
    return { ...r, userId: r.userId, name: r.handle, settledTotal: r.total, points, [key]: l };
  }));
}

/**
 * October, live. Every open day that has a started game contributes each
 * entry's scoreCard total (live slots and final slots alike - the settle
 * waits for the last game, the board does not).
 *
 * Returns { rows, liveContestId, live } - liveContestId is the day the
 * snapshots ride on (the newest open day with a game under way or done).
 */
export async function octoberLive(season, { preview = false, memberIds = null, now = new Date() } = {}) {
  const base = await octoberBoard(season, { now, limit: ALL, memberIds, preview });
  const open = await openContests('october', season, preview);
  const live = new Map(); let liveContestId = null; let anyLive = false;
  for (const c of open) {
    const { statBy, matchBy } = await boxFor(c);
    const started = [...matchBy.values()].some((m) => m.status === 'live' || m.status === 'final');
    if (!started) continue;
    liveContestId = c.id;
    if ([...matchBy.values()].some((m) => m.status === 'live')) anyLive = true;
    for (const [uid, lineup] of await lineupsOf(c.id)) {
      const card = scoreCard(lineup, statBy, matchBy);
      const prev = live.get(uid) ?? { points: 0, slotsLive: 0 };
      live.set(uid, {
        points: round1(prev.points + card.total),
        slotsLive: prev.slotsLive + card.slots.filter((s) => s.state === 'live').length,
      });
    }
  }
  // EVERY ENTRANT IS ALREADY IN base: octoberBoard lists a user for any entry,
  // settled day or not, so a player whose only card is today's is a row on 0.
  return { rows: withLive(base, live, 'today'), liveContestId, anyLive };
}

/**
 * The Run, live. The open round's entries score through scoreRoster against
 * the round's box scores; each row gains rounds[round] = { kind: 'live',
 * points } for the round in play.
 */
export async function runLive(season, { preview = false, memberIds = null, now = new Date() } = {}) {
  const base = await runBoard(season, { memberIds, preview, now, limit: ALL });
  const open = await openContests('run', season, preview);
  const live = new Map(); let liveContestId = null; let liveRound = null;
  for (const c of open) {
    const rows = await boxForRound(c);
    if (!rows.length) continue;
    const idx = Number(c.week ?? c.meta?.roundIndex);
    liveRound = ROUNDS[idx - 1] ?? null;
    liveContestId = c.id;
    for (const [uid, lineup] of await lineupsOf(c.id)) {
      const card = scoreRoster(lineup, rows, []);
      // NOBODY SET IS A DASH, not a live 0.0 - the settled board's own rule
      // (runBoard: a half-roster is not a commitment, an empty one even less).
      if (card.filled === 0) continue;
      live.set(uid, { points: card.total, round: liveRound, alive: card.alive, filled: card.filled });
    }
  }
  const ranked = withLive(base, live, 'round').map((r) => (r.round && liveRound
    ? { ...r, rounds: { ...r.rounds, [liveRound]: { kind: 'live', points: r.round.points } } }
    : r));
  return { rows: ranked, liveContestId, liveRound };
}

/** PURE. One round's column as its own ranked board (The Run's per-round view). */
export function roundView(rows = [], round) {
  const scored = rows
    .map((r) => {
      const cell = r.rounds?.[round] ?? null;
      const points = cell?.kind === 'points' || cell?.kind === 'live' ? Number(cell.points) : null;
      // A ROUND'S OWN SUBMISSION orders its ties (lib/games/rank.js).
      return points == null ? null : { ...r, points, cell, submittedAt: r.roundAt?.[round] ?? null };
    })
    .filter(Boolean);
  return rankRows(scored);
}

/** Movement for a live MLB board: its snapshots ride on the contest in play. */
export async function withMlbMovement(board, now = new Date()) {
  if (!board.liveContestId) return board.rows.map((r) => ({ ...r, dPoints: null, dRank: null }));
  const then = await standingsAt(board.liveContestId, new Date(now).getTime() - MOVEMENT_MIN * 60_000);
  return withMovement(board.rows, then);
}

/**
 * THE MLB POLLER'S WRITE, the NFL one's twin (lib/boards/live.js
 * snapshotLiveBoards): after a box score, each tournament with a contest in
 * play gets one snapshot row per entrant whose standing moved - keyed on that
 * contest, holding the TOURNAMENT total and rank, because that is what the
 * board's movement is about.
 */
export async function snapshotMlbBoards({ season = new Date().getUTCFullYear(), now = new Date() } = {}) {
  let written = 0; let boards = 0;
  for (const preview of [false, true]) {
    for (const b of [await octoberLive(season, { preview, now }), await runLive(season, { preview, now })]) {
      if (!b.liveContestId || !b.rows.length) continue;
      boards += 1;
      const last = await standingsAt(b.liveContestId, new Date(now).getTime() + 1000);
      const moved = b.rows.filter((r) => {
        const l = last.get(r.userId);
        return !l || round1(l.points) !== round1(r.points) || l.rank !== r.rank;
      });
      if (!moved.length) continue;
      await sql`
        INSERT INTO live_board_snapshots (contest_id, user_id, ts, points, rank)
        SELECT ${b.liveContestId}, u, ${new Date(now).toISOString()}, p, k
          FROM unnest(${moved.map((r) => r.userId)}::int[], ${moved.map((r) => r.points)}::numeric[], ${moved.map((r) => r.rank)}::int[]) AS t(u, p, k)`;
      written += moved.length;
    }
  }
  return { boards, written };
}
