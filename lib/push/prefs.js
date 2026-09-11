// lib/push/prefs.js — what a reader asked for, and whether this event is it.
// PURE: no database, no clock, no network.

/** The shipped defaults. A follower who has never opened the sheet gets these,
 * and so does the row a fresh master tap writes (nextRow, R1). Kickoff, score
 * changes, close game and the final; quarter ends off - the noisiest row. */
export const DEFAULTS = Object.freeze({
  master: true, kickoff: true, score: true, quarter: false, close: true, final: true,
});

/** Everything off. What a MATCH-SCOPE sheet with no saved row must show -
 * see resolvePrefs()'s `scope` parameter. */
export const OFF = Object.freeze({
  master: false, kickoff: false, score: false, quarter: false, close: false, final: false,
});

/**
 * THE `final` TRIGGER IS STORED IN THE `final_only` COLUMN (ALERTS SHEET
 * relay, R2). final_only used to be a suppressor - "only the final, silence
 * the rest". It is now an ordinary trigger called Final, on by default, and
 * the column is reused rather than migrated: every row that had final_only
 * true was a reader who wanted the final, and under the new reading that is
 * exactly what the bit says. No data moves, no migration, and the ten legacy
 * rows keep sending finals. The rename lives in code only: this map is the
 * ONE place the column name appears outside SQL, and nothing else reads
 * final_only.
 */
export const COLUMN_OF = Object.freeze({
  master: 'master', kickoff: 'kickoff', score: 'score', quarter: 'quarter', close: 'close',
  final: 'final_only',
});
export const FIELDS = Object.freeze(Object.keys(DEFAULTS));
/** `master, kickoff, score, quarter, close, final_only AS final` - the SELECT
 * list that reads a row back into pref shape. */
export const SELECT_FIELDS = FIELDS
  .map((f) => (COLUMN_OF[f] === f ? f : `${COLUMN_OF[f]} AS ${f}`)).join(', ');

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
 * FIVE TRIGGERS, ONE RULE EACH. The final is a trigger like the other four
 * (ALERTS SHEET relay, R2) - on by default, because the result is the one
 * moment everybody who subscribed to a game wants, but a reader may turn it
 * off like anything else. It used to ride the `quarter` toggle (20729 on
 * 5 Sep got sixteen score alerts and no final), then sent on master alone,
 * with final_only as a suppressor over the other four. Neither survives: a
 * suppressor beside four toggles meant a row could say "score: on" and send
 * nothing, and the sheet had to explain itself with a "Silenced by" line.
 */
export function wants(prefs, event) {
  const p = prefs ?? DEFAULTS;
  if (!p.master) return false;
  switch (event) {
    case 'kickoff': return Boolean(p.kickoff);
    case 'score': return Boolean(p.score);
    // QUARTER ENDS ONLY; the final has its own flag.
    case 'quarter': return Boolean(p.quarter);
    case 'close': return Boolean(p.close);
    case 'final': return Boolean(p.final);
    default: return false;
  }
}

/**
 * WHAT ONE PUT WRITES (ALERTS SHEET relay, R1). Pure, and shared by the route
 * and the sheet so the optimistic row on screen is the row the server keeps.
 *
 *   master ON, no saved row   -> the DEFAULTS row. A fresh tap means "alert
 *                                me about this game", not "alert me about
 *                                nothing", which is what writing the OFF
 *                                flags the sheet was showing would mean.
 *   master ON, row exists     -> the body, whole. The reader's own flags.
 *   master OFF, row exists    -> master false, triggers untouched. Silencing
 *                                a game must not forget what was chosen.
 *   master OFF, no saved row  -> master false with the body's triggers (the
 *                                team defaults the sheet was showing, or
 *                                DEFAULTS for a null field), so turning it
 *                                back on gives back what was on screen.
 *
 * `existing` is the saved row for this exact scope (null when there is none),
 * not the resolved prefs: a match sheet showing a team row's flags still has
 * no match row, and that is the case R1 is about.
 */
export function nextRow(existing, body) {
  const incoming = {};
  for (const f of FIELDS) incoming[f] = body?.[f] == null ? DEFAULTS[f] : Boolean(body[f]);
  if (incoming.master) return existing ? incoming : { ...DEFAULTS };
  if (existing) return { ...DEFAULTS, ...strip(existing), master: false };
  return incoming;
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
