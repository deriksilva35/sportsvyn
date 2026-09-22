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

/**
 * THE POOL BAR: how much of this reader's October is left, split by whether
 * the club is still alive. The mock's own three lines - and the last one is
 * the sentence the whole burn rule exists to make possible: "Milwaukee went
 * out Sunday and took three of your bats with them."
 */
export function poolSplit({ used = new Map(), rosterTeamOf = new Map(), aliveTeams = new Set(), totalPool = 0 }) {
  const spent = used.size;
  let aliveLeft = 0; const byTeam = new Map(); let deadLeft = 0; const deadTeams = new Set();
  for (const [playerId, team] of rosterTeamOf) {
    if (used.has(String(playerId))) continue;
    if (aliveTeams.has(team)) {
      aliveLeft += 1;
      byTeam.set(team, (byTeam.get(team) ?? 0) + 1);
    } else { deadLeft += 1; deadTeams.add(team); }
  }
  return {
    used: spent,
    aliveLeft,
    deadLeft,
    byTeam: [...byTeam].sort((a, b) => b[1] - a[1]),
    deadTeams: [...deadTeams].sort(),
    // The bar: spent, then still-available-and-alive, and the rest is
    // available-but-eliminated.
    pct: totalPool > 0
      ? { used: pct(spent, totalPool), alive: pct(aliveLeft, totalPool) }
      : { used: 0, alive: 0 },
  };
}
const pct = (n, d) => Math.round((n / d) * 1000) / 10;
