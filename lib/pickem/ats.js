// lib/pickem/ats.js - AGAINST THE SPREAD (S3). PURE and client-safe.
//
// THE LINE IS FROZEN AT WEEK OPEN. ensurePickemBoard snapshots each game's
// current home-based spread into contests.board[i].spread_home when the board is
// created; a later line move never touches it (the snapshot is the board, the
// same posture as locks_at). SIGNED and HOME-BASED, like getSpreadHome: negative
// means the home side is favoured.
//
// A GAME WITH NO LINE AT WEEK OPEN IS VOID FOR ATS: it neither scores nor counts
// toward the max (the safest rule - nobody is graded on a number nobody saw).
// Its national result is untouched.
//
// HOME COVERS when (home - away) + spread_home > 0; AWAY covers when it is < 0.
// EXACTLY 0 IS A PUSH: void, 0 points, not in the max. Only the final score and
// the frozen number decide - never today's line.
//
// Stored at settle as contests.perfect.ats = { results, max }, results:
//   { [match_id]: 'home' | 'away' | 'push' | null }   null = no line / void / no score.

/** ATS is a football format: NFL and CFB only. */
export const ATS_SPORTS = Object.freeze(['nfl', 'cfb']);
export const atsSport = (sport) => ATS_SPORTS.includes(String(sport ?? '').toLowerCase());

/** A stored spread -> a finite number or null. 0 is a real line (pick'em). */
export function cleanSpread(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Who covered. null = no frozen line or no final score. PURE. */
export function atsOutcome(spreadHome, homeScore, awayScore) {
  const s = cleanSpread(spreadHome);
  if (s == null || homeScore == null || awayScore == null) return null;
  const h = Number(homeScore); const a = Number(awayScore);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const m = (h - a) + s;
  if (m > 0) return 'home';
  if (m < 0) return 'away';
  return 'push';
}

/**
 * The ATS results for a board. byId: Map(match_id -> { status, home_score, away_score }).
 * voids: match ids void nationally (postponed past the cutoff) - void here too.
 * stored/keep: on a re-grade, `keep(matchId)` true keeps the stored value.
 */
export function atsResults(board, byId, { voids = [], stored = null, keep = null } = {}) {
  const voidSet = new Set((voids ?? []).map(Number));
  const out = {};
  for (const g of board ?? []) {
    const key = String(g.match_id);
    if (stored && keep && keep(g)) { out[key] = stored[key] ?? null; continue; }
    const m = byId.get(Number(g.match_id));
    out[key] = voidSet.has(Number(g.match_id)) || m?.status !== 'final'
      ? null
      : atsOutcome(g.spread_home, m.home_score, m.away_score);
  }
  return out;
}

/** perfect.ats.max: the games with a cover side. A push and a no-line game are out. */
export const atsMax = (results = {}) => Object.values(results ?? {}).filter((v) => v === 'home' || v === 'away').length;

/** Points in a flat lineup: one per pick on the covering side. */
export function atsScore(lineup = {}, results = {}) {
  let n = 0;
  for (const [id, side] of Object.entries(lineup ?? {})) if (results?.[id] != null && results[id] === side) n += 1;
  return n;
}

/** W-L-P over the picks; a push is counted as P, a no-line game as nothing. */
export function atsRecord(lineup = {}, results = {}) {
  let w = 0; let l = 0; let p = 0;
  for (const [id, side] of Object.entries(lineup ?? {})) {
    const r = results?.[id];
    if (r === 'push') { p += 1; continue; }
    if (r !== 'home' && r !== 'away') continue;
    if (r === side) w += 1; else l += 1;
  }
  return { w, l, p };
}

/** "-3.5" for the home side, "+3.5" for the away side, "PK" at zero; '' with no line. */
export function spreadFor(spreadHome, side) {
  const s = cleanSpread(spreadHome);
  if (s == null) return '';
  if (s === 0) return 'PK';
  const v = side === 'home' ? s : -s;
  return `${v > 0 ? '+' : '−'}${Math.abs(v)}`;
}

/** Freeze a plan's board with the spreads read at week open. spreads: Map(match_id -> number). PURE. */
export function freezeSpreads(board, spreads) {
  return (board ?? []).map((g) => ({ ...g, spread_home: cleanSpread(spreads?.get?.(g.match_id)) }));
}
