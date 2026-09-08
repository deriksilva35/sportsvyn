import { displayTeamCode } from '../footballdb/historicalTeamDisplay.js';

// lib/daily/boardShape.js — the season-roster board's slot shape. PURE.
//
// EIGHT SLOTS, ONE SHAPE, ALL 46 SEASONS (ruling). QB/RB/RB/WR/WR/FLEX/FLEX/K
// - no DEF, no TE slot, no era branch. Two rejected shapes on the way here:
//   - Nine slots with a DEF: no source this codebase holds reaches back far
//     enough for team defence, in any era.
//   - Eight slots with a dedicated TE: footballdb cannot tell a TE from a WR
//     (its own tab-presence heuristic defaults every receiving-only row to
//     WR), so 1980-1998 carries almost no TE-tagged row at all - measured,
//     1/28 teams for the whole 1980-1991 span. A dedicated TE slot made that
//     a fillability GATE: only 43% of random 1982 draws could complete one.
// DROPPING THE TE SLOT DISSOLVES THE PROBLEM INSTEAD OF WORKING AROUND IT.
// FLEX already takes TE (see FLEX_ELIGIBLE below) - a 1999+ tight end,
// correctly labelled TE by nflverse, is FLEX-eligible, never claimed to be a
// wide receiver. A pre-1999 tight end, folded into WR by the source itself,
// is exactly what footballdb actually asserts - not a gap, not a guess, the
// literal shape of the data. TWO FLEX SLOTS, not one: the board still asks
// for eight picks, and with the scarcest position gone, the flexes are where
// the real allocation decisions live.
export const SLOTS = Object.freeze(['QB', 'RB', 'RB', 'WR', 'WR', 'FLEX', 'FLEX', 'K']);

// THREE MINUTES FROM START, AND THE CLOCK IS ON THE SERVER. started_at
// (migration 097) is the anchor; the client counts down from it and the
// server refuses a submit past it. Until this constant existed the v2 clock
// counted UP with no limit at all - a stopwatch, not a round - and Derik's
// first run took 31 minutes.
export const DAILY_ROUND_SECONDS = 180;
// Network and clock skew allowance on the SERVER side only. A submit that
// fires at 3:00.4 on the client is not a cheat; one at 3:06 is a DNF.
export const DAILY_ROUND_GRACE_SECONDS = 5;

// The distinct slot NAMES (SLOTS has RB and WR twice - a real player fills
// one instance, but eligibility is checked against the name, not the index).
export const SLOT_NAMES = Object.freeze([...new Set(SLOTS)]);

// FLEX absorbs the three skill positions, standard fantasy convention. QB and
// K never flex - a QB in a FLEX slot is a different game (2QB / superflex),
// out of scope here; a kicker was never eligible for FLEX in any convention
// this product follows.
const FLEX_ELIGIBLE = Object.freeze(['RB', 'WR', 'TE']);

// THE SLOT IS NAMED 'K', THE STORED POSITION IS 'PK'. Every kicker row in
// nfl_player_season_totals (both source halves - footballdb's inferPosition
// and the BDL ingest's ffcPosition mapping) writes position='PK', matching
// the house vocabulary established across this whole codebase (nfl_players.
// position, sim_player_pool, etc.). 'K' is the SLOT label a board reader
// expects (matching the fantasy-standard slot name); a literal position===
// slot compare would silently make every K slot infeasible against real
// data, exactly the kind of one-name mismatch this session has hit before.
const SLOT_POSITION_ALIAS = Object.freeze({ K: 'PK' });

/** Is a player at `position` eligible for `slot`? PURE, no state. */
export function eligibleForSlot(position, slot) {
  if (slot === 'FLEX') return FLEX_ELIGIBLE.includes(position);
  return position === (SLOT_POSITION_ALIAS[slot] ?? slot);
}

// The five positions nfl_player_season_totals can ever usefully carry for
// THIS board. Both source halves agree on this scope already: footballdb's
// own inferPosition() never writes a row with no slot in QB/RB/WR/TE/PK, and
// the BDL aggregation was built to match that scope deliberately (see
// scripts/bdl-season-totals-backfill.mjs's header). A row outside this set
// (CB, DB, DT, UNK - two-way-player artifacts, or an unresolved BDL position)
// has no slot on this board and is filtered before anything else runs.
export const BOARD_POSITIONS = Object.freeze(['QB', 'RB', 'WR', 'TE', 'PK']);

// THE ONE PLACE v2's OWN URL IS WRITTEN (relay 5b item 7). Every surface
// that names this board - the push copy (lib/push/copy.js), the grade
// screen's share block (components/daily/season/SeasonBoard.js), and
// whatever names it next - imports this instead of typing '/daily/board'
// again. v1's own surfaces (app/daily/page.js, its own push copy under the
// 'daily-v1-live'/'daily-v1-revealed' keys, its share card) keep '/daily'
// unconditionally and never import this constant - the two games are not
// the same URL and never were.
export const DAILY_V2_PATH = '/daily/board';

/** Season-row stat line -> the one-line meta string a board card shows.
 * Moved here from seasonBoardEditions.js so the write side and the pure
 * grade module share it without the grade module importing the DB. */
export function metaFor(r) {
  switch (r.position) {
    case 'QB': return `${r.pass_yds ?? 0} yds · ${r.pass_td ?? 0} TD`;
    case 'RB': return `${r.rush_yds ?? 0} rush · ${r.rush_td ?? 0} TD`;
    case 'WR':
    case 'TE': return `${r.rec ?? 0} rec · ${r.rec_yds ?? 0} yds · ${r.rec_td ?? 0} TD`;
    case 'PK': return `${r.fgm ?? 0}/${r.fga ?? 0} FG`;
    default: return '';
  }
}

/**
 * THE ONE SHAPE OF A BEST-ROSTER ENTRY:
 *   { slot, teamKey, abbr, name, points, meta, position }
 *
 * WHY THIS EXISTS. The first submitted v2 run (8 Sep 2026) graded every slot
 * MISSED - Cam Newton paired against himself - because the board's two halves
 * were stored in two shapes. `board` went through shapeTeams() (name, meta),
 * while `best_roster` was JSON.stringify(optimum.bySlot) straight off the
 * solver, whose player rows carried raw_name and team_key and no meta. The
 * grader read b.player.name off the second and got undefined eight times.
 *
 * IDEMPOTENT, and it detects which shape it was handed:
 *   - an entry with a `player` object is the SOLVER's nested shape; inside
 *     it, raw_name marks a raw season row and name marks a shaped card
 *   - an entry with a top-level `name` is already normalised and passes
 *     through untouched
 * Both the write side (seasonBoardEditions) and the read side (seasonBoardRuns,
 * gradeFromOptimum) call this, so the row already stored raw grades right
 * without a backfill, and nothing raw can be written again.
 */
export function shapeBestRoster(bySlot) {
  return (bySlot ?? []).map((b) => {
    if (b && b.player == null && typeof b.name === 'string') return b; // already flat
    const p = b.player ?? {};
    const teamKey = b.teamKey ?? p.team_key ?? null;
    return {
      slot: b.slot,
      teamKey,
      abbr: teamKey == null ? null : displayTeamCode(teamKey),
      name: p.name ?? p.raw_name ?? null,
      points: p.points,
      meta: p.meta ?? metaFor(p),
      position: p.position,
    };
  });
}
