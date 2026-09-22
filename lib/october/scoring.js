// lib/october/scoring.js - what a line is worth. PURE, and the table is
// printed ON the card (docs/design/mocks/october-v0_2.html, the live screen's
// footer) because a scoring rule a player cannot see is a rule they cannot
// play to.
//
// WRITE ONCE, NEVER CHANGE MID-TOURNAMENT. The relay's first rule, and the
// reason this is a frozen table in its own module rather than numbers spread
// through a settle: a value edited on day 9 silently re-grades days 1 to 8
// the next time anything recomputes, and nobody can tell which total was
// which. Every number below is the relay's own.
//
// IT READS mlb_player_game_stats, which stores COUNTING STATS ONLY - the
// provider's avg/obp/slg/era on a game row are season-to-date rates and
// migration 110 refuses them for exactly this reason. Nothing here needs one.

/** Bats. The relay's table, verbatim. */
export const BAT_POINTS = Object.freeze({
  single: 3, double: 5, triple: 8, homeRun: 10,
  rbi: 2, run: 2, walk: 2, stolenBase: 5,
});

/**
 * Arms. IP IS SCORED PER OUT, which is the whole reason the column stores
 * outs: 2.25 a full inning is 0.75 an out, and a pitcher lifted with one down
 * in the sixth has 16 outs and 12.0 points - not "5.1 innings" run through a
 * number that does not divide.
 */
export const ARM_POINTS = Object.freeze({
  perOut: 2.25 / 3, strikeout: 2, win: 4,
  earnedRun: -2, hitAllowed: -0.6, walkAllowed: -0.6,
});

/** The card's own words for the footer, generated from the table above so the
 *  printed rules and the scored rules cannot drift apart. */
export const RULES_LINE = Object.freeze({
  bats: `1B ${BAT_POINTS.single} · 2B ${BAT_POINTS.double} · 3B ${BAT_POINTS.triple} · HR ${BAT_POINTS.homeRun} · RBI ${BAT_POINTS.rbi} · R ${BAT_POINTS.run} · BB ${BAT_POINTS.walk} · SB ${BAT_POINTS.stolenBase}`,
  arms: `IP 2.25 · K ${ARM_POINTS.strikeout} · W ${ARM_POINTS.win} · ER ${ARM_POINTS.earnedRun} · H ${ARM_POINTS.hitAllowed} · BB ${ARM_POINTS.walkAllowed}`,
});

const n = (v) => {
  if (v == null || v === '') return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * SINGLES ARE DERIVED, NEVER STORED, and this is the one arithmetic decision
 * in the file. The provider sends `hits` as the TOTAL - a home run is a hit -
 * so scoring hits and home runs separately pays a home run 13 and not 10.
 * Verified against the mock's own Harper line: 1-3 with a home run is 14.0
 * (HR 10 + R 2 + RBI 2), which only works if the hit is not also a single.
 *
 * It cannot go negative: a row with more extra-base hits than hits is a
 * broken row, and the floor keeps it from paying a bat for not batting.
 */
export function singlesOf(row) {
  return Math.max(0, n(row?.hits) - n(row?.doubles) - n(row?.triples) - n(row?.home_runs));
}

/** One batting line -> points. */
export function batPoints(row) {
  if (!row) return 0;
  return singlesOf(row) * BAT_POINTS.single
    + n(row.doubles) * BAT_POINTS.double
    + n(row.triples) * BAT_POINTS.triple
    + n(row.home_runs) * BAT_POINTS.homeRun
    + n(row.rbi) * BAT_POINTS.rbi
    + n(row.runs) * BAT_POINTS.run
    + n(row.walks) * BAT_POINTS.walk
    + n(row.stolen_bases) * BAT_POINTS.stolenBase;
}

/**
 * One pitching line -> points, and it CAN be negative. A start that goes two
 * innings and gives up seven is worth less than nothing, which is the risk
 * the arm slot exists to carry; clamping it at zero would make a disaster
 * indistinguishable from a bullpen day nobody used.
 */
export function armPoints(row) {
  if (!row) return 0;
  return n(row.outs_recorded) * ARM_POINTS.perOut
    + n(row.strikeouts_pitched) * ARM_POINTS.strikeout
    + n(row.wins) * ARM_POINTS.win
    + n(row.earned_runs) * ARM_POINTS.earnedRun
    + n(row.hits_allowed) * ARM_POINTS.hitAllowed
    + n(row.walks_allowed) * ARM_POINTS.walkAllowed;
}

/**
 * THE SLOT DECIDES WHICH TABLE, not the row. A two-way player has both halves
 * on one row (migration 110's shape) and an arm slot must pay him for
 * pitching and nothing else - otherwise Ohtani in the arm slot quietly scores
 * a start plus a batting line, which is two players in one slot.
 *
 * Rounded to one decimal at the very last moment: 0.75 an out and -0.6 a hit
 * both produce long tails, and a leaderboard that shows 31.5 must be summing
 * numbers that are actually 31.5.
 */
export function slotPoints(slot, row) {
  const raw = slot === 'arm' ? armPoints(row) : batPoints(row);
  return round1(raw);
}

export const round1 = (x) => Math.round((Number(x) || 0) * 10) / 10;

/**
 * THE LINE A CARD PRINTS under a name: "2-4 · 2B · 2 RBI". The mock's own
 * grammar - at-bats first, then only what happened. An empty line for a
 * player who has not batted yet, never "0-0 · 0 RBI".
 */
export function batLine(row) {
  if (!row) return null;
  const bits = [];
  if (row.at_bats != null) bits.push(`${n(row.hits)}-${n(row.at_bats)}`);
  const add = (count, label) => { if (n(count) > 0) bits.push(n(count) > 1 ? `${n(count)} ${label}` : label); };
  add(row.doubles, '2B'); add(row.triples, '3B'); add(row.home_runs, 'HR');
  if (n(row.rbi) > 0) bits.push(`${n(row.rbi)} RBI`);
  if (n(row.runs) > 0) bits.push(`${n(row.runs)} R`);
  add(row.walks, 'BB'); add(row.stolen_bases, 'SB');
  return bits.length ? bits.join(' · ') : null;
}

/** "5.1 IP · 7 K · 1 ER" - the arm's counterpart. */
export function armLine(row) {
  if (!row) return null;
  const bits = [];
  const outs = n(row.outs_recorded);
  if (row.outs_recorded != null) bits.push(`${Math.floor(outs / 3)}.${outs % 3} IP`);
  if (n(row.strikeouts_pitched) > 0) bits.push(`${n(row.strikeouts_pitched)} K`);
  if (row.earned_runs != null) bits.push(`${n(row.earned_runs)} ER`);
  if (n(row.wins) > 0) bits.push('W');
  return bits.length ? bits.join(' · ') : null;
}
