// lib/run/board.js - the league board and the everyone board, one reader.
//
// PRIVATE LEAGUES RIDE THE EXISTING SPINE. player_leagues and league_members
// already carry creation, join codes, membership and the invite link
// (lib/leagues/core.js); The Run adds no table and no second notion of a
// league. "Everyone" is the same query with the member filter removed, which
// is why the mock can put it in the same row of chips.

import { sql } from '../db.js';
import { ROUNDS, ROUND_LABEL, DNF } from './rules.js';
import { round1 } from '../mlb/fantasyPoints.js';

/**
 * One standing, four round columns and a total.
 *
 * A ROUND CELL HAS THREE STATES and the mock draws all three: a NUMBER once
 * the round has settled, "set" while it is committed but unplayed, and "DNF"
 * where the nine were never set. A dash is the fourth - the round has not
 * opened for this reader yet.
 */
export async function runBoard(season, { memberIds = null, now = new Date(), limit = 50 } = {}) {
  const rows = memberIds
    ? await sql`
      SELECT e.user_id, u.handle, u.name, u.is_house, c.week, c.settled,
             e.score, e.lineup, e.meta->'run' AS run
        FROM contest_entries e
        JOIN contests c ON c.id = e.contest_id
        LEFT JOIN users u ON u.id = e.user_id
       WHERE c.game_type = 'run' AND c.sport = 'mlb' AND c.season_year = ${season}
         AND e.user_id = ANY(${memberIds})
       ORDER BY c.week ASC`
    : await sql`
      SELECT e.user_id, u.handle, u.name, u.is_house, c.week, c.settled,
             e.score, e.lineup, e.meta->'run' AS run
        FROM contest_entries e
        JOIN contests c ON c.id = e.contest_id
        LEFT JOIN users u ON u.id = e.user_id
       WHERE c.game_type = 'run' AND c.sport = 'mlb' AND c.season_year = ${season}
       ORDER BY c.week ASC`;

  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.user_id)) {
      by.set(r.user_id, {
        userId: r.user_id,
        handle: r.handle ?? r.name ?? 'player',
        house: r.is_house === true,
        total: 0,
        rounds: Object.fromEntries(ROUNDS.map((x) => [x, null])),
      });
    }
    const e = by.get(r.user_id);
    const round = ROUNDS[Number(r.week) - 1];
    if (!round) continue;
    const state = r.run?.state ?? null;
    if (r.settled) {
      e.total = round1(e.total + (Number(r.score) || 0));
      e.rounds[round] = state === DNF ? { kind: 'dnf' } : { kind: 'points', points: Number(r.score) || 0 };
    } else {
      // COMMITTED BUT UNPLAYED. Nine filled slots is "set"; anything less is
      // still a dash, because a half-roster is not a commitment.
      const filled = Object.keys(r.lineup ?? {}).length;
      e.rounds[round] = filled >= 9 ? { kind: 'set' } : null;
    }
  }

  const standing = [...by.values()].sort((a, b) => b.total - a.total || a.handle.localeCompare(b.handle));
  const leader = standing[0]?.total ?? 0;
  return standing.slice(0, limit).map((e, i) => ({ ...e, rank: i + 1, back: round1(leader - e.total) }));
}

export const ROUND_COLUMNS = Object.freeze(
  ROUNDS.map((r) => ({ round: r, short: { wild_card: 'WC', division: 'DIV', championship: 'LCS', world_series: 'WS' }[r], label: ROUND_LABEL[r] })),
);

/**
 * THE POOL BAR, in three parts - the mock draws used / alive / eliminated,
 * and the third is the one the burn rule makes matter: a player you never
 * used, on a club that is out, is gone just as surely as one you spent.
 */
export function poolSplit({ used = new Map(), aliveClubs = [], deadClubs = [], poolSize = 0 }) {
  const spent = used.size;
  const alive = Math.max(0, poolSize - spent);
  return {
    used: spent,
    aliveClubs: aliveClubs.map((c) => c.abbr ?? c).sort(),
    deadClubs: deadClubs.map((c) => c.abbr ?? c).sort(),
    unusedAlive: alive,
    pct: poolSize > 0
      ? { used: pct(spent, poolSize), alive: pct(alive, poolSize) }
      : { used: 0, alive: 0 },
  };
}
const pct = (n, d) => Math.round((n / d) * 1000) / 10;
