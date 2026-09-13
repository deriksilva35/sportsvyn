// lib/gridiron/todayPicks.js - the Today tab's picks block, both codes.
//
// LIGHT ON PURPOSE (TODAY TAB v2, Q5). pickemBoardView() would answer this
// exactly, but it pulls AP ranks, team colours, team records and spreads for
// every game on both boards - roughly fifty games of decoration to print five
// chips and a record, on the page people open most. This assembles the same
// answer from the three pieces that actually carry it: currentPickemBoard for
// the board, one scores query for the live state, and myPicks for the picks.
//
// THE FIVE CHIP STATES COME FROM status AND kicked, NOT FROM graded (Q7).
// gameRows' `graded` is 'W' | 'L' | null and is only set on a final, so it
// cannot tell a game in progress from one that has not kicked. The rule:
//
//   won      graded === 'W'                       the pick was right
//   lost     graded === 'L'                       the pick was wrong
//   live     picked, status !== 'final', kicked    it is being played
//   pending  picked, not kicked                    it has not started
//   none     no pick on that game                  counted, never chipped
//
// A game with no pick is never a chip. It is counted into `unpicked` and the
// strip says "12 pending" once, rather than drawing twelve empty outlines.

import { sql } from '../db.js';
import { currentPickemBoard, myPicks } from '../pickem/entry.js';
import { gameRows, recordOf } from '../pickem/view.js';
import { nextLock } from '../pickem/read.js';

export const PICK_SPORTS = Object.freeze(['nfl', 'cfb']);

/** The five states, as one rule both the chips and the counts read. */
export function chipState(row) {
  if (!row?.my_side) return 'none';
  if (row.graded === 'W') return 'won';
  if (row.graded === 'L') return 'lost';
  return row.kicked ? 'live' : 'pending';
}

/**
 * THE BOARD STORES NAMES, NOT ABBREVIATIONS - a board row carries
 * home: "Seahawks" and home_team_id, and the chips want SEA. One lookup,
 * scoped to the teams the reader actually PICKED, which is at most a couple
 * of dozen ids rather than both boards' worth of colours and records.
 */
async function abbrFor(teamIds) {
  const ids = [...new Set(teamIds.filter((x) => x != null))];
  if (!ids.length) return new Map();
  const rows = await sql`SELECT id, abbreviation, short_name, name FROM teams WHERE id = ANY(${ids})`;
  return new Map(rows.map((r) => [r.id, r.abbreviation ?? r.short_name ?? r.name ?? null]));
}

async function liveById(board) {
  const ids = board.map((g) => g.match_id);
  if (!ids.length) return new Map();
  const rows = await sql`SELECT id, status, home_score, away_score FROM matches WHERE id = ANY(${ids})`;
  return new Map(rows.map((r) => [r.id, r]));
}

/** One league's picks, or null when that league has no live board. */
export async function pickStripFor(userId, { sport, now = new Date() } = {}) {
  const contest = await currentPickemBoard({ sport, now }).catch(() => null);
  if (!contest || contest.settled) return null;
  const board = contest.board ?? [];
  if (!board.length) return null;
  const [live, picks] = await Promise.all([
    liveById(board).catch(() => new Map()),
    userId == null ? Promise.resolve({}) : myPicks(contest.id, userId).catch(() => ({})),
  ]);
  // gameRows takes empty maps for the decoration this strip does not draw -
  // no ranks, no colours, no records, no spreads. That is the whole saving.
  const rows = gameRows({ board, liveById: live, picks, now });
  const record = recordOf(rows);
  const picked = rows.filter((r) => r.my_side);
  const abbr = await abbrFor(picked.map((r) => (r.my_side === 'home' ? r.home_team_id : r.away_team_id))).catch(() => new Map());
  return {
    sport,
    label: sport.toUpperCase(),
    href: `/pickem/${sport}`,
    total: rows.length,
    record: { wins: record.wins, losses: record.losses },
    // The chips a reader can act on or learn from, decided once.
    chips: picked.map((r) => ({
      matchId: r.match_id,
      abbr: abbr.get(r.my_side === 'home' ? r.home_team_id : r.away_team_id)
        ?? (r.my_side === 'home' ? r.home : r.away) ?? null,
      state: chipState(r),
    })),
    unpicked: rows.length - picked.length,
    pendingPicked: picked.filter((r) => chipState(r) === 'pending').length,
  };
}

/**
 * BOTH CODES, one shape. A league with no live board contributes nothing
 * rather than an empty row saying so.
 *
 * `nextLock` is asked once across both sports rather than per league: the
 * strip prints ONE next lock, and the soonest of the two is that answer.
 */
export async function todayPicks(userId, { now = new Date() } = {}) {
  const [strips, at] = await Promise.all([
    Promise.all(PICK_SPORTS.map((s) => pickStripFor(userId, { sport: s, now }).catch(() => null))),
    nextLock({ sport: null, now }).catch(() => null),
  ]);
  const leagues = strips.filter(Boolean);
  if (!leagues.length) return null;
  const chips = leagues.flatMap((l) => l.chips);
  return {
    leagues,
    chips,
    nextLock: at,
    // The whole-strip counts, so the card's foot never has to re-derive them.
    unpicked: leagues.reduce((n, l) => n + l.unpicked, 0),
    pendingPicked: leagues.reduce((n, l) => n + l.pendingPicked, 0),
    entered: chips.length > 0,
  };
}
