// lib/boards/live.js - the always-on public boards: every entry, ranked, live.
//
// ============================================================================
// ONE BOARD PER GAME, READ THE WAY THE ROOM ALREADY READS IT
// ============================================================================
// The Weekly and the Draft already had a live number: lib/weekly/live.js
// liveBoard() sums every entry against nfl_player_game_stats on read (the
// lobby's table, the room's "your rank"). What they did not have was a PAGE -
// the national table, your row pinned, and where everybody stood ten minutes
// ago. This module is that page's read, and the poller's one write.
//
// NOW IS COMPUTED, THEN IS REMEMBERED. The live total is exact at read time
// (the stat rows are the truth, ~5 min behind the box score). Movement needs
// where each entry stood ten minutes ago, which nothing else keeps, so the
// poller writes live_board_snapshots (migration 116) after a box score that
// changed something - one row per entry whose points or rank moved, never a
// row per poll.
//
// COMPETITION RANK: equal totals share a rank (1, 2, 2, 4). liveBoard breaks
// ties by user id, which is a stable ORDER but not a fair PLACE - two players
// on 86.4 are both 1,283rd, and the board says so.
//
// NAME + TOTAL ONLY. Rows carry rank / user / name / points / played and the
// house mark - never a lineup or a roster (liveBoard selects none onto its
// rows; lib/weekly/live.test.mjs pins that law and this module inherits it).
//
// NO BOARD OF ZEROS. Before the week's first kickoff every total is 0 and a
// ranked table would just be the entry list in user-id order - the lobby's
// "sealed entries never wear zeros" rule (weeklyBoardTable). The board opens
// at first kickoff and says so until then.

import { sql } from '../db.js';
import { liveBoard } from '../weekly/live.js';
import { firstKickoff } from '../weekly/pool.js';
import { displayName } from '../daily/handles.js';
import { houseMark } from '../house/mark.js';
import { rankRows, withMovement, boardView } from './view.js';

// THE PURE HALF LIVES IN ./view.js (no database import), so a page or a render
// test can shape a board without loading a driver; re-exported here unchanged.
export { rankRows, withMovement, boardView };

export const MOVEMENT_MIN = 10;
export const BOARD_GAMES = Object.freeze({
  weekly: { gameType: 'weekly', title: 'The Weekly', path: '/weekly/board', home: '/weekly' },
  draft: { gameType: 'draft', title: 'The Draft', path: '/draft/board', home: '/draft' },
});

const round1 = (x) => Math.round(Number(x) * 10) / 10;

/** Where every entry stood at `at`: its newest snapshot row at or before it. */
export async function standingsAt(contestId, at) {
  const r = await sql`
    SELECT DISTINCT ON (user_id) user_id, points, rank
      FROM live_board_snapshots
     WHERE contest_id = ${contestId} AND ts <= ${new Date(at).toISOString()}
     ORDER BY user_id, ts DESC`;
  return new Map(r.map((x) => [x.user_id, { points: Number(x.points), rank: x.rank }]));
}

/** The settled board: the settle's scores are the ruling, not a live sum. */
async function settledRows(contest) {
  const e = await sql`
    SELECT e.user_id, e.score, u.handle, u.is_house
      FROM contest_entries e JOIN users u ON u.id = e.user_id
     WHERE e.contest_id = ${contest.id} AND e.score IS NOT NULL`;
  return e.map((x) => ({
    userId: x.user_id, name: displayName({ id: x.user_id, handle: x.handle }),
    points: Number(x.score), played: null,
    ...houseMark({ isHouse: x.is_house === true, handle: x.handle }, contest.game_type),
  }));
}

/** Every entry's live total for an unsettled contest, competition-ranked. */
export async function liveRows(contest) {
  const rows = await liveBoard(contest, { limit: Number.MAX_SAFE_INTEGER });
  return rankRows(rows.map(({ rank, total, ...r }) => ({ ...r, points: total })));
}

/**
 * THE PAGE'S READ for one game (weekly | draft). No viewer in it - the "you"
 * is picked out by boardView - so the result is the same for every reader.
 *
 * state: 'none'     no contest has opened
 *        'prekick'  opened, first kickoff still ahead (no board of zeros)
 *        'live'     locked slots scoring, not settled
 *        'final'    settled - the settle's scores
 */
export async function gameBoard(game, { now = new Date(), sport = 'nfl', memberIds = null } = {}) {
  const g = BOARD_GAMES[game];
  if (!g) return null;
  const c = (await sql`
    SELECT * FROM contests
     WHERE game_type = ${g.gameType} AND sport = ${sport} AND opens_at <= ${now.toISOString()}
     ORDER BY season_year DESC, week DESC LIMIT 1`)[0] ?? null;
  if (!c) return { game, state: 'none', contest: null, rows: [] };
  const contest = { id: c.id, week: c.week, season_year: c.season_year, game_type: c.game_type, board: c.board, settled: c.settled };
  // A LEAGUE IS THE SAME BOARD WITH ITS MEMBERS ONLY, ranked among themselves.
  // memberIds == null is National; an EMPTY league is an empty board, never the
  // world (the house rule, lib/leagues/core.test.mjs).
  const inLeague = (rows) => (memberIds == null ? rows : rows.filter((r) => memberIds.map(Number).includes(Number(r.userId))));
  if (c.settled) return { game, state: 'final', contest, rows: rankRows(inLeague(await settledRows(c))) };
  const ko = await firstKickoff(c.season_year, c.week);
  if (!ko || new Date(ko).getTime() > now.getTime()) return { game, state: 'prekick', contest, firstKickoff: ko ? new Date(ko).toISOString() : null, rows: [] };
  const rows = memberIds == null ? await liveRows(c) : rankRows(inLeague(await liveRows(c)).map(({ rank, ...r }) => r));
  const then = await standingsAt(c.id, now.getTime() - MOVEMENT_MIN * 60_000);
  // THE SNAPSHOTS HOLD NATIONAL RANKS, so a league view moves in POINTS only -
  // a national place is not a place in the league.
  const moved = withMovement(rows, then);
  return { game, state: 'live', contest, league: memberIds != null, rows: memberIds == null ? moved : moved.map((r) => ({ ...r, dRank: null })) };
}

/**
 * THE POLLER'S WRITE. After an NFL box score that changed something, every
 * unsettled Weekly and Draft contest past its first kickoff gets one snapshot
 * row per entry whose points or rank moved since its last row - one INSERT
 * per contest (unnest), nothing when nothing moved.
 *
 * Returns { contests, written } for the poller's journal line.
 */
export async function snapshotLiveBoards({ sport = 'nfl', now = new Date() } = {}) {
  const open = await sql`
    SELECT * FROM contests
     WHERE game_type IN ('weekly', 'draft') AND sport = ${sport}
       AND settled IS NOT TRUE AND opens_at <= ${now.toISOString()}`;
  let contests = 0; let written = 0;
  for (const c of open) {
    const ko = await firstKickoff(c.season_year, c.week);
    if (!ko || new Date(ko).getTime() > now.getTime()) continue;
    contests += 1;
    const rows = await liveRows(c);
    const last = await standingsAt(c.id, now.getTime() + 1000);
    const moved = rows.filter((r) => {
      const l = last.get(r.userId);
      return !l || round1(l.points) !== round1(r.points) || l.rank !== r.rank;
    });
    if (!moved.length) continue;
    await sql`
      INSERT INTO live_board_snapshots (contest_id, user_id, ts, points, rank)
      SELECT ${c.id}, u, ${now.toISOString()}, p, k
        FROM unnest(${moved.map((r) => r.userId)}::int[], ${moved.map((r) => r.points)}::numeric[], ${moved.map((r) => r.rank)}::int[]) AS t(u, p, k)`;
    written += moved.length;
  }
  return { contests, written };
}
