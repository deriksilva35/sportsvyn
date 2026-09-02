// lib/fantasy/statView.js - how a player row is PRESENTED, FILTERED and ORDERED.
// Pure spec: no DB, no React, no invented data.
//
// The single home for the sim's view logic: the display-vocab mapping, the
// position/team/search filter, the per-position stat spec, and the sort keys.
// Everything derives from the structured stat line produced by
// getPlayerSeasonStats, so the game log, the quick stats, the season totals and
// the sort keys can never disagree about what a player did.
//
// Positions arrive in FFC vocab: PK = kicker, DEF = team defense. displayPosition
// maps those to the labels a user reads (K, DST); nothing in the room should keep
// its own copy of that mapping.

import { compareSeat } from './seatValuation.js';

const n = (x) => Number(x ?? 0) || 0;

// -- number display, ONE DECIMAL EVERYWHERE ---------------------------------
// The columns' formatters, shared by both rooms: a bare '2' next to a '2.4'
// reads as a different kind of number, so every PPG and VAL renders through
// these. ADP is a RANK and stays an integer - that is r0's job, not fmt1's.
/** '12.0', '-28.0'; '-' for missing or non-finite (holds the column).
 * null is MISSING, not zero - Number(null) is 0 and would lie. */
export function fmt1(x) {
  if (x == null || x === '') return '-';
  const v = Number(x);
  return Number.isFinite(v) ? v.toFixed(1) : '-';
}
/** '+3.9' / '-28.0' - fmt1 with the explicit sign VAL carries. */
export function signed1(x) {
  if (x == null || x === '') return '-';
  const v = Number(x);
  if (!Number.isFinite(v)) return '-';
  return v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
}
/** The ADP window a row prints after its position and team: '12-18'. NULL when
 * either bound is missing - a Fantrax snapshot carries a single ADP and no
 * window (lib/fantrax/import.js writes adp only), and a row must then print
 * NOTHING, not '?-?': a stat with no value renders neither label nor separator.
 * The caller owns the ' · ' that joins it to the line, so the separator goes
 * with the value. Bounds are ranks, so they round like r0 does. */
export function adpRange(high, low) {
  if (high == null || low == null || high === '' || low === '') return null;
  const h = Number(high), l = Number(low);
  if (!Number.isFinite(h) || !Number.isFinite(l)) return null;
  return `${Math.round(h)}-${Math.round(l)}`;
}

// FFC/roster position vocab -> the label shown to the user. The ONE place this
// mapping lives on the client (drafts.js has the server-side DTO copy). Only PK
// and DEF differ from their display form; everything else is identity.
const DISPLAY_POS = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', PK: 'K', DEF: 'DST' };
export function displayPosition(pos) { return DISPLAY_POS[pos] ?? pos; }

// The available-list filter definitions, hoisted from BOTH rooms (they had
// drifted into duplicate local consts - the ROSTER_CELLS lesson again). One
// definition, two renderers; a hand-written copy in either is forbidden by
// test.
export const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];
export const CLASS_FILTERS = [['ALL', 'All'], ['ROOKIE', 'Rookies'], ['VET', 'Vets']];

// Distinct team abbreviations present in a player list, sorted alphabetically.
// Nulls (a player with no team) are dropped rather than surfaced as a blank option.
export function teamsInPool(list) {
  return [...new Set((list ?? []).map((p) => p.team).filter(Boolean))].sort();
}

// The available-board filter: position (in DISPLAY vocab, matching the chips),
// team abbreviation, and a name substring. 'ALL' on either axis is a pass.
// Kept here, not inline in the room, so position+team composition is unit-tested.
// NOTE: this filter does NOT drive the stat-sort gating - sortsFor() keys off the
// POSITION filter alone, so narrowing by team never enables a stat sort.
// `cls` is the rookie/veteran class filter: 'ALL' | 'ROOKIE' | 'VET'.
//
// VETERAN IS THE DEFAULT READING OF ABSENCE. A player is a rookie only when the
// flag is explicitly true; everyone else - established veterans, unmatched pool
// rows, engine-synthesised filler - filters as a veteran and carries no chip.
// That is deliberate and matches the chip: we have no "unknown" bucket, because
// showing one would turn a gap in our data into a claim about a player.
//
// Every predicate composes: ROOKIE + RB is rookie running backs, not a union.
export function filterPlayers(list, { position = 'ALL', team = 'ALL', search = '', cls = 'ALL' } = {}) {
  const q = String(search ?? '').trim().toLowerCase();
  return (list ?? []).filter((p) => (
    (position === 'ALL' || displayPosition(p.position) === position)
    && (team === 'ALL' || p.team === team)
    && (cls === 'ALL' || (cls === 'ROOKIE' ? p.rookie === true : p.rookie !== true))
    && (!q || String(p.name ?? '').toLowerCase().includes(q))
  ));
}

/**
 * The room's rookie lookup, as a Set of ffc_player_id.
 *
 * WHY THE ROOMS NEED A SET AT ALL. Pick records are built by the draft engine,
 * which is deliberately never told which players are rookies - so a pick coming
 * back mid-draft carries no flag, and the ledger cannot read one off the row.
 * Seeding from the INITIAL available list UNION the INITIAL picks covers every
 * case: a player drafted during the session was in `available` at page load, and
 * one drafted before it arrives on `picks` already flagged by the server.
 *
 * IT IS ALSO WHAT KEEPS TRACKER UNDO HONEST. undoLastPick rebuilds the restored
 * row from the removed pick's own columns (id, name, position), which carry no
 * rookie field - so a rookie put back on the board would silently lose his chip
 * if the list trusted the row. Looking the id up here survives any number of
 * round trips between the two lists, because the set is built once from the
 * props and never from the mutating state.
 */
export function rookieIdSet(available = [], picks = []) {
  const s = new Set();
  for (const p of available) if (p?.rookie === true) s.add(p.ffcPlayerId);
  for (const p of picks) if (p?.rookie === true) s.add(p.ffcPlayerId);
  return s;
}

// columns: game-log headers (first is always OPP; `row` returns the rest)
// row:     one game's cells, derived from that game's structured stats
// totals:  the season numbers to headline on the strip
// quick:   the headline line shown beside the name on the collapsed row
const VIEW = {
  QB: {
    columns: ['OPP', 'CMP/ATT', 'YDS', 'TD', 'INT'],
    row: (s) => [`${n(s.passCmp)}/${n(s.passAtt)}`, String(n(s.passYds)), String(n(s.passTd)), String(n(s.int))],
    totals: (t) => [
      { label: 'PASS YDS', value: String(n(t.passYds)) },
      { label: 'PASS TD', value: String(n(t.passTd)) },
      { label: 'INT', value: String(n(t.int)) },
    ],
    quick: (t) => [`${n(t.passYds)} YDS`, `${n(t.passTd)} TD`],
  },
  RB: {
    columns: ['OPP', 'CAR', 'RUSH YDS', 'REC', 'TD'],
    row: (s) => [String(n(s.rushAtt)), String(n(s.rushYds)), String(n(s.rec)), String(n(s.rushTd) + n(s.recTd))],
    totals: (t) => [
      { label: 'RUSH YDS', value: String(n(t.rushYds)) },
      { label: 'REC', value: String(n(t.rec)) },
      { label: 'TD', value: String(n(t.rushTd) + n(t.recTd)) },
    ],
    quick: (t) => [`${n(t.rushYds)} RUSH`, `${n(t.rec)} REC`, `${n(t.rushTd) + n(t.recTd)} TD`],
  },
  WR: {
    columns: ['OPP', 'TGT', 'REC', 'REC YDS', 'TD'],
    row: (s) => [String(n(s.tgt)), String(n(s.rec)), String(n(s.recYds)), String(n(s.recTd))],
    totals: (t) => [
      { label: 'REC', value: String(n(t.rec)) },
      { label: 'REC YDS', value: String(n(t.recYds)) },
      { label: 'TD', value: String(n(t.recTd)) },
    ],
    quick: (t) => [`${n(t.rec)} REC`, `${n(t.recYds)} YDS`, `${n(t.recTd)} TD`],
  },
  PK: {
    columns: ['OPP', 'FGM/FGA', 'LNG', 'XP'],
    row: (s) => [`${n(s.fgm)}/${n(s.fga)}`, String(n(s.fgLong)), String(n(s.xp))],
    totals: (t) => [
      { label: 'FG MADE', value: String(n(t.fgm)) },
      { label: 'XP', value: String(n(t.xp)) },
    ],
    quick: (t) => [`${n(t.fgm)} FG`, `${n(t.xp)} XP`],
  },
  DEF: {
    columns: ['OPP', 'SACK', 'INT', 'FR', 'TD'],
    row: (s) => [String(n(s.sacks)), String(n(s.defInt)), String(n(s.fr)), String(n(s.defTd))],
    totals: (t) => [
      { label: 'SACKS', value: String(n(t.sacks)) },
      { label: 'INT', value: String(n(t.defInt)) },
      { label: 'DEF TD', value: String(n(t.defTd)) },
    ],
    quick: (t) => [`${n(t.sacks)} SK`, `${n(t.defInt)} INT`],
  },
};
VIEW.TE = VIEW.WR; // same receiving line

export function viewFor(position) { return VIEW[position] ?? VIEW.WR; }

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------
// A stat sort is only meaningful WITHIN a position: ranking a mixed board by
// receptions buries every QB under every WR, which reads like a bug. So the
// stat keys below are offered only when the board is filtered to that position.
// ADP / PPG / PTS are the exceptions - they compare across positions honestly -
// and are always available.
//
// metric(summary) -> number, or null when unknown (unknown always sorts LAST,
// never as a zero: "no data" is not "was bad"). asc:true means lower is better.

const UNIVERSAL = [
  { key: 'adp', label: 'ADP', asc: true, metric: null }, // metric null = sort by the board's ADP
  // ROSTER-AWARE. `compare` rather than `metric`, because there is no single
  // number to rank by: the key is the slot bucket and then the market gap, which
  // are the two facts the row displays. See seatValuation.js for why this is not
  // a composite score.
  { key: 'myteam', label: 'My Team', seat: true, compare: compareSeat },
  { key: 'ppg', label: 'PPG', metric: (s) => s?.ppg ?? null },
  { key: 'points', label: 'PTS', metric: (s) => s?.points ?? null },
];

const stat = (key, label, get, opts = {}) => ({
  key, label, ...opts, metric: (s) => (s?.totals ? get(s.totals) : null),
});

const BY_POSITION = {
  QB: [
    stat('passYds', 'YDS', (t) => n(t.passYds)),
    stat('passTd', 'TD', (t) => n(t.passTd)),
    stat('int', 'INT', (t) => n(t.int), { asc: true }), // fewer is better
  ],
  RB: [
    stat('rushYds', 'RUSH', (t) => n(t.rushYds)),
    stat('rec', 'REC', (t) => n(t.rec)),
    stat('td', 'TD', (t) => n(t.rushTd) + n(t.recTd)),
  ],
  WR: [
    stat('rec', 'REC', (t) => n(t.rec)),
    stat('recYds', 'YDS', (t) => n(t.recYds)),
    stat('recTd', 'TD', (t) => n(t.recTd)),
  ],
  K: [
    stat('fgm', 'FG', (t) => n(t.fgm)),
    stat('xp', 'XP', (t) => n(t.xp)),
  ],
  DST: [
    stat('sacks', 'SACK', (t) => n(t.sacks)),
    stat('defInt', 'INT', (t) => n(t.defInt)),
    stat('defTd', 'TD', (t) => n(t.defTd)),
  ],
};
BY_POSITION.TE = BY_POSITION.WR;

/**
 * Sort options for the current position filter.
 * @param {string} filter  roster-slot vocab: 'ALL' | QB | RB | WR | TE | K | DST
 */
export function sortsFor(filter) {
  return [...UNIVERSAL, ...(BY_POSITION[filter] ?? [])];
}

/**
 * Order a player list by a sort option. Stable and total: unknown metrics sink
 * to the bottom and ADP breaks every tie, so the board never jitters.
 * @param {Array} list        pool players (need .adp, .ffcPlayerId)
 * @param {object} opt        one of sortsFor()
 * @param {object} summaries  ffcPlayerId -> season summary (may be empty)
 */
export function sortPlayers(list, opt, summaries, ctx = null) {
  const byAdp = (a, b) => Number(a.adp) - Number(b.adp);
  // Roster-aware sorts bring their own comparator and read `ctx` (a Map built
  // once per pick), because their key is a bucket-then-gap sequence rather than
  // a single metric. Ties fall through to ADP so the order is total and stable.
  if (opt && opt.compare) {
    return [...list].sort((a, b) => opt.compare(a, b, ctx) || byAdp(a, b));
  }
  if (!opt || !opt.metric) return [...list].sort(byAdp);
  return [...list].sort((a, b) => {
    const av = opt.metric(summaries[a.ffcPlayerId]);
    const bv = opt.metric(summaries[b.ffcPlayerId]);
    if (av == null && bv == null) return byAdp(a, b);
    if (av == null) return 1; // unknown last, regardless of direction
    if (bv == null) return -1;
    if (av !== bv) return opt.asc ? av - bv : bv - av;
    return byAdp(a, b);
  });
}
