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
export async function octoberBoard(season, { now = new Date(), limit = 50 } = {}) {
  const rows = await sql`
    SELECT e.user_id, u.handle, u.name, u.is_house,
           c.puzzle_date, c.settled, e.score, e.meta->'october' AS oct
      FROM contest_entries e
      JOIN contests c ON c.id = e.contest_id
      LEFT JOIN users u ON u.id = e.user_id
     WHERE c.game_type = 'october' AND c.sport = 'mlb' AND c.season_year = ${season}
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

