// lib/october/board.js - the one October leaderboard, and today's.
//
// ONE TOURNAMENT TOTAL. The mock's board is a single standing that runs from
// the Wild Card to the World Series with a day's delta beside it - not a
// per-day board that resets, which would make the burn rule pointless: the
// whole reason a player is spent for the tournament is that the tournament is
// the unit being scored.

import { sql } from '../db.js';
import { round1 } from '../mlb/fantasyPoints.js';
import { DNF } from './rules.js';

/**
 * Every settled day's entries, folded into one standing.
 *
 * A DNF DAY CONTRIBUTES 0 AND IS REMEMBERED. The settle already wrote 0 into
 * `score`, so the sum is right without a branch here; `meta.october.state` is
 * what lets the row print "DNF" in the delta column, which the mock does.
 */
/**
 * ONE ENTRY, ANY NUMBER OF LEAGUES - the ruling, and it falls out of the shape
 * rather than being enforced anywhere.
 *
 * A league does not hold entries. It holds MEMBERS, and a league board is this
 * same query with `e.user_id = ANY(memberIds)` bolted on - so a reader who is in
 * four leagues has ONE card on the day and appears on all four boards with the
 * same number. There is no per-league entry to keep in step, which is the whole
 * reason there is nothing to keep in step.
 *
 * "EVERYONE" IS THE FILTER REMOVED. Same reader, same rows, no member clause -
 * which is why the mock can put Everyone in the same row of chips as the leagues.
 * Identical to lib/run/board.js's runBoard, deliberately: two games, one spine.
 *
 * A PREVIEW DAY AND A REAL DAY NEVER SUM, and the clause is runBoard's own:
 * COALESCE((meta->>'preview')::boolean, false) = ${preview}. September's preview
 * and October's postseason are the same season_year, so without this a reader's
 * six preview cards would be added to their wild-card total and the board would
 * report a number nobody played for. The CALLER says which tournament it is
 * asking about - app/october/board/page.js takes it from the day it is showing.
 *
 * @param memberIds  null for Everyone; an array of user ids for one league
 * @param preview    true reads the preview's days, false the postseason's
 */
export async function octoberBoard(season, { now = new Date(), limit = 50, memberIds = null, preview = false } = {}) {
  // `memberIds == null`, NEVER A FALSY SHORTCUT. An EMPTY league must get an
  // EMPTY board, not the world - and `[]` is truthy in JS, so a truthy test
  // happens to be right while reading as if it were not. The explicit null check
  // is the house rule (lib/leagues/core.test.mjs asserts it of the Weekly) and it
  // is what makes the failure mode safe: leagueMemberIds' own .catch returns [],
  // which shows nothing rather than leaking everyone into a league view.
  const rows = memberIds != null
    ? await sql`
      SELECT e.user_id, u.handle, u.name, u.is_house,
             c.puzzle_date, c.settled, e.score, e.meta->'october' AS oct
        FROM contest_entries e
        JOIN contests c ON c.id = e.contest_id
        LEFT JOIN users u ON u.id = e.user_id
       WHERE c.game_type = 'october' AND c.sport = 'mlb' AND c.season_year = ${season}
         AND COALESCE((c.meta->>'preview')::boolean, false) = ${preview}
         AND e.user_id = ANY(${memberIds})
       ORDER BY c.puzzle_date ASC`
    : await sql`
      SELECT e.user_id, u.handle, u.name, u.is_house,
             c.puzzle_date, c.settled, e.score, e.meta->'october' AS oct
        FROM contest_entries e
        JOIN contests c ON c.id = e.contest_id
        LEFT JOIN users u ON u.id = e.user_id
       WHERE c.game_type = 'october' AND c.sport = 'mlb' AND c.season_year = ${season}
         AND COALESCE((c.meta->>'preview')::boolean, false) = ${preview}
       ORDER BY c.puzzle_date ASC`;

  const today = String(new Date(now).toISOString()).slice(0, 10);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.user_id)) {
      by.set(r.user_id, {
        userId: r.user_id, handle: r.handle ?? r.name ?? 'player',
        // OPENLY THE HOUSE. lib/house/personas.js's first law - a house row
        // carries its marker beside the handle so a reader can tell in one
        // glance that it is us.
        house: r.is_house === true,
        total: 0, days: 0, dnf: 0, todayPoints: null, todayState: null,
      });
    }
    const e = by.get(r.user_id);
    const day = String(r.puzzle_date).slice(0, 10);
    const state = r.oct?.state ?? null;
    if (r.settled) {
      e.total = round1(e.total + (Number(r.score) || 0));
      e.days += 1;
      if (state === DNF) e.dnf += 1;
    }
    if (day === today) { e.todayPoints = r.score == null ? null : Number(r.score); e.todayState = state; }
  }

  const standing = [...by.values()].sort((a, b) => b.total - a.total || a.handle.localeCompare(b.handle));
  const leader = standing[0]?.total ?? 0;
  return standing.slice(0, limit).map((e, i) => ({
    ...e, rank: i + 1, back: round1(leader - e.total),
  }));
}

// THERE IS NO POOL BAR. poolSplit() lived here and split a reader's October into
// spent players and live ones - the burn, made visible. October has no burn now
// (lib/october/rules.js), so there is nothing to split, and /october/board shows
// which clubs are left instead: a fact about the tournament rather than about
// anybody's card. THE RUN KEEPS ITS OWN poolSplit() in lib/run/board.js.

