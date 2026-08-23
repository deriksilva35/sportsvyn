// lib/soccer/liveChip.js - where in the match, for soccer.
//
// A SIBLING OF THE GRIDIRON FORMATTER, NOT AN EXTENSION OF IT. Both answer
// "where in the game", and both are one-definition-per-code by the same law -
// but the grammars share no vocabulary: gridiron counts DOWN inside four
// numbered quarters ('Q4 · 8:12'), soccer counts UP through two open-ended
// halves with stoppage added on ("67'", "90+4'"). Folding them into one
// function would mean a sport switch inside every branch; the honest split is
// one module per code, and the pins live in each code's own test file.
//
// THE CLOCK IS A SNAPSHOT at the poller's cadence. Render it plainly - no
// ticking, it moves when the poll does. Same honest-gap law as gridiron.

/** The provider's period shorts that mean "the ball is not moving". */
const BREAKS = { HT: 'HT', BT: 'BT', INT: 'INT', SUSP: 'SUSP', P: 'PENS' };

/**
 * "67'" / "90+4'" / "HT" / "PENS" / null.
 * @param liveState {elapsed, extra, period} as written by the poller
 */
export function soccerLiveChip(liveState) {
  if (!liveState) return null;
  const period = String(liveState.period ?? '').toUpperCase();
  if (period in BREAKS) return BREAKS[period];
  const elapsed = Number(liveState.elapsed);
  if (!Number.isFinite(elapsed)) return period || null;
  const extra = Number(liveState.extra);
  return Number.isFinite(extra) && extra > 0 ? `${elapsed}+${extra}'` : `${elapsed}'`;
}

/**
 * The live_state value the poller stores, or NULL when the match is not
 * live - a stale clock must never outlive the match it described (the
 * gridiron law, applied here).
 */
export function soccerLiveState(status, fixtureStatus) {
  if (status !== 'live') return null;
  return {
    elapsed: fixtureStatus?.elapsed ?? null,
    extra: fixtureStatus?.extra ?? null,
    period: fixtureStatus?.short ?? null,
  };
}

/** FT/HT-style label for a finished match's status row. */
export const FINAL_LABEL = 'FT';
