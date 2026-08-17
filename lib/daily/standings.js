// lib/daily/standings.js - season points and the leaderboards. PURE.
//
// ============================================================================
// THE LAW: STANDINGS ARE COMPUTED FROM REVEALED DAYS ONLY.
// ============================================================================
// The overall board must never encode an OPEN day's result. This is not a
// display preference, it is the leak rule expressed as arithmetic, and the
// reasoning is worth keeping because the failure is invisible:
//
// If today's entry contributed to season points, the overall module on the
// entered screen would MOVE the moment a rival locked their lineup. Anyone
// watching a total go from 38 to 42 has just learned that player took an MVP
// today - the exact number the leak rule exists to protect, published as a
// delta instead of a score. The board becomes a side channel.
//
// So: seasonStandings() takes only rows from revealed days, and the caller is
// responsible for not handing it anything else. Two consequences follow and
// both are deliberate:
//   - NO TODAY COLUMN anywhere on the overall board.
//   - NO RANK MOVEMENT - no "up 3 places", no arrows. A delta against
//     yesterday's board is a statement about today, computed by subtraction.
// The board is frozen at the last close and moves once, at midnight.
//
// TIER POINTS RATHER THAN RAW SCORES, and this is measured rather than felt.
// Across all 174 weeks in the corpus the ceiling of a board (its top five PPR
// performances) runs 127.0 to 233.5 - an 84% spread, with 40 points between
// p10 and p90. Summing raw daily scores would therefore rank partly on WHICH
// DAYS a player happened to show up: two players of identical skill separate by
// dozens of points on draw luck. The tier ladder is already a RATIO of that
// day's perfect, so tier points normalise difficulty for free, stay integers
// that read at a glance, and keep a newcomer's deficit finite.

/** HOF 5 · MVP 4 · PRO BOWLER 3 · STARTER 2 · PRACTICE SQUAD 1. */
export const TIER_POINTS = {
  'HALL OF FAME': 5,
  MVP: 4,
  'PRO BOWLER': 3,
  STARTER: 2,
  'PRACTICE SQUAD': 1,
};

/** A DNF and a day you never opened are both zero. Neither is a penalty. */
export const pointsForTier = (label) => TIER_POINTS[label] ?? 0;

/**
 * SEASON ONE RUNS LONG. The NFL boundary is early September, which would make
 * the first season a three-week stub - a leaderboard nobody can build a habit
 * on, reset just as they do. Season one is "2026-27" and runs through the
 * September 2027 boundary; every season after it is a normal year.
 */
export const SEASON_BOUNDARY_MONTH = 9;   // September
export const SEASON_BOUNDARY_DAY = 1;
export const FIRST_SEASON = { key: '2026-27', from: '2026-08-16', to: '2027-08-31' };

export function seasonKeyFor(dateStr) {
  const d = String(dateStr ?? '');
  // SHAPE-CHECK FIRST. '' splits to [''] and Number('') is 0, which is finite -
  // so a null date would otherwise resolve to a real-looking season key for
  // year zero rather than to nothing.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (d >= FIRST_SEASON.from && d <= FIRST_SEASON.to) return FIRST_SEASON.key;
  const [y, m, day] = d.split('-').map(Number);
  if (!Number.isFinite(y)) return null;
  const beforeBoundary = m < SEASON_BOUNDARY_MONTH
    || (m === SEASON_BOUNDARY_MONTH && day < SEASON_BOUNDARY_DAY);
  const start = beforeBoundary ? y - 1 : y;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Build the overall table.
 *
 * @param {Array} rows  one per (player, REVEALED day):
 *   { userId, handle, tier, score, perfect }
 * @param {number} daysPlayable  revealed days in the season, for "12/17"
 *
 * TIEBREAK: cumulative percent of perfect, then days played. Points alone tie
 * constantly - five tiers over seventeen days is a small space - and the
 * percentage is the finer-grained version of the same judgement rather than a
 * different one. Days played breaks the remainder toward whoever showed up
 * more, which is the behaviour the board is for.
 */
export function seasonStandings(rows, daysPlayable = 0) {
  const by = new Map();
  for (const r of rows ?? []) {
    const id = r.userId;
    if (id == null) continue;
    if (!by.has(id)) {
      by.set(id, {
        userId: id, handle: r.handle ?? null,
        points: 0, played: 0, pctSum: 0, hof: 0, mvp: 0, daysPlayable,
      });
    }
    const e = by.get(id);
    if (r.handle) e.handle = r.handle;
    e.points += pointsForTier(r.tier);
    e.played += 1;
    const perfect = Number(r.perfect) || 0;
    if (perfect > 0) e.pctSum += (Number(r.score) || 0) / perfect;
    if (r.tier === 'HALL OF FAME') e.hof += 1;
    if (r.tier === 'MVP') e.mvp += 1;
  }

  const out = [...by.values()].sort((a, b) => (
    b.points - a.points
    || b.pctSum - a.pctSum
    || b.played - a.played
    // Last resort is the id, so the order is total and a redraw cannot shuffle
    // two identical rows past each other.
    || a.userId - b.userId
  ));

  // COMPETITION RANKING: equal rows share a rank and the next one skips. Two
  // players on identical points, percentage and days played are tied, and
  // printing 4th and 5th would invent a distinction the data does not carry.
  let lastKey = null;
  let lastRank = 0;
  out.forEach((e, i) => {
    const key = `${e.points}|${e.pctSum.toFixed(6)}|${e.played}`;
    if (key !== lastKey) { lastRank = i + 1; lastKey = key; }
    e.rank = lastRank;
    e.pct = e.played ? Math.round((e.pctSum / e.played) * 1000) / 10 : 0;
  });
  return out;
}

/**
 * A day's board: ranked by score, DNFs unranked at the foot.
 *
 * DNFs ARE LISTED, not hidden. The attempt was consumed - the board was seen -
 * so omitting them would make "1,204 entries" and 1,180 rows disagree with no
 * explanation on the page.
 */
export function dayLeaderboard(rows) {
  const played = (rows ?? []).filter((r) => r.score != null && !r.dnf);
  const dnf = (rows ?? []).filter((r) => r.dnf || r.score == null);

  played.sort((a, b) => Number(b.score) - Number(a.score) || a.userId - b.userId);
  let lastScore = null;
  let lastRank = 0;
  played.forEach((r, i) => {
    const s = Number(r.score);
    if (s !== lastScore) { lastRank = i + 1; lastScore = s; }
    r.rank = lastRank;
  });
  return [...played, ...dnf.map((r) => ({ ...r, rank: null }))];
}

/**
 * Top N, with the reader's own row pinned when it falls outside.
 *
 * The module has to answer "where did I come" without shipping 1,204 rows to a
 * phone, and a player in 31st place cares about exactly one row that is not in
 * the top 25.
 */
export function topWithSelf(ranked, userId, n = 25) {
  const top = (ranked ?? []).slice(0, n);
  if (userId == null) return { top, self: null };
  const inTop = top.some((r) => r.userId === userId);
  const self = inTop ? null : (ranked ?? []).find((r) => r.userId === userId) ?? null;
  return { top, self };
}
