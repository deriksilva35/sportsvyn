// lib/push/prefs.js — what a reader asked for, and whether this event is it.
// PURE: no database, no clock, no network.

/** The shipped defaults. A follower who has never opened the sheet gets these. */
export const DEFAULTS = Object.freeze({
  master: true, kickoff: true, score: true, quarter: false, close: true, final_only: false,
});

/** Everything off. What a MATCH-SCOPE sheet with no saved row must show -
 * see resolvePrefs()'s `scope` parameter. */
export const OFF = Object.freeze({
  master: false, kickoff: false, score: false, quarter: false, close: false, final_only: false,
});

export const EVENTS = Object.freeze(['kickoff', 'score', 'quarter', 'close', 'final']);

/**
 * TEAM IS THE DEFAULT, MATCH IS THE OVERRIDE, AND THE OVERRIDE IS THE ROW.
 *
 * There is no "inherit" value and no tri-state: a match row exists or it does
 * not, and its mere presence means "for this game, ignore what I said about
 * the team". Not a field-by-field merge - a reader who turns score off for one
 * game must not have it turned back on by a team default they set in March.
 * The override is whole, which makes "reset to team defaults" a DELETE rather
 * than a value nobody can name.
 *
 * NO SAVED ROW ANYWHERE, MATCH SCOPE: renders OFF, not DEFAULTS (RELAY -
 * GAME ALERTS FIX ruling - "the screen may never show a push the system
 * will not attempt"). Pass scope: 'match' from a match-scope caller (the
 * per-game sheet) to get this. A caller that reaches this branch there has
 * neither a saved match row nor a saved team row - and audienceFor()'s
 * match-scoped entry point REQUIRES an actual saved row to be a candidate
 * at all, so DEFAULTS' master:true would be a lie about what the system
 * will do. dispatch.js's own resolvePrefs() call never passes scope: a
 * reader reaching this branch THERE can only be a real team-follower (the
 * follows entry point has no saved-row requirement), for whom DEFAULTS is
 * correct and unchanged - "Defaults ON apply only to teams the user
 * follows."
 */
export function resolvePrefs({ teamPref = null, matchPref = null, scope = null } = {}) {
  if (matchPref) return { ...DEFAULTS, ...strip(matchPref), source: 'match' };
  if (teamPref) return { ...DEFAULTS, ...strip(teamPref), source: 'team' };
  if (scope === 'match') return { ...OFF, source: 'default' };
  return { ...DEFAULTS, source: 'default' };
}

const strip = (p) => {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) if (p[k] != null) out[k] = Boolean(p[k]);
  return out;
};

/**
 * Does this event reach this reader?
 *
 * MASTER FIRST, AND IT IS NOT A SIXTH TOGGLE. It gates the other five, so
 * master=false with score=true is a coherent stored state: the reader silenced
 * the game without losing what they had chosen, and turning master back on
 * gives them exactly what they had.
 *
 * final_only IS A SUPPRESSOR, NOT A SELECTOR. It sits beside the others rather
 * than replacing them, so switching it off restores the previous selection
 * instead of a blank slate.
 */
export function wants(prefs, event) {
  const p = prefs ?? DEFAULTS;
  if (!p.master) return false;
  if (p.final_only) return event === 'final';
  switch (event) {
    case 'kickoff': return Boolean(p.kickoff);
    case 'score': return Boolean(p.score);
    // ONE TOGGLE FOR TWO MOMENTS, because "end of each quarter and the final"
    // is one idea to a reader and splitting it would be a row that says the
    // same thing twice.
    case 'quarter':
    case 'final': return Boolean(p.quarter);
    case 'close': return Boolean(p.close);
    default: return false;
  }
}

/**
 * THE CLOSE-GAME RULE. Q4, one score apart, under five minutes.
 *
 * PURE AND SEPARATE from wants() because it is a statement about the GAME, not
 * about the reader: whether the moment qualifies is the same answer for
 * everybody, and only whether they hear about it differs.
 *
 * ONE SCORE IS EIGHT POINTS - touchdown and two-point conversion - which is
 * the margin at which a game is genuinely still in doubt. Seven would exclude
 * the comeback everyone stays up for.
 */
export const CLOSE_MAX_DIFF = 8;
export const CLOSE_MAX_SEC = 300;

export function clockToSeconds(clock) {
  if (typeof clock !== 'string') return null;
  const m = clock.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const mm = Number(m[1]), ss = Number(m[2]);
  if (ss > 59) return null;
  return mm * 60 + ss;
}

export function isCloseGame({ period, clock, homeScore, awayScore } = {}) {
  if (Number(period) !== 4) return false;
  const secs = clockToSeconds(clock);
  if (secs == null || secs > CLOSE_MAX_SEC) return false;
  const h = Number(homeScore), a = Number(awayScore);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return false;
  return Math.abs(h - a) <= CLOSE_MAX_DIFF;
}

/**
 * THE EVENT KEY - what makes a send unrepeatable.
 *
 * Same shape and same reason as the Wire's dedupe_hash. A score key names a
 * score STATE, so the poll thirty seconds later collides. The CLOSE key names
 * the GAME and nothing else, because the rule fires once per game: keying it on
 * the clock would send one every thirty seconds for the last five minutes of
 * every one-score game, which is the flood this exists to prevent.
 */
export function eventKey(event, match, { homeScore, awayScore, period } = {}) {
  switch (event) {
    case 'score': return `score:${match}:${homeScore}:${awayScore}`;
    case 'kickoff': return `kickoff:${match}`;
    case 'final': return `final:${match}`;
    case 'quarter': return `quarter:${match}:${period}`;
    case 'close': return `close:${match}`;
    default: return null;
  }
}
