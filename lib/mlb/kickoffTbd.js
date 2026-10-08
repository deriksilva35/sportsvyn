// lib/mlb/kickoffTbd.js - a first pitch nobody has set yet (tue-10). PURE.
//
// BDL HAS NO "TIME TBD" FIELD. A game whose time is not set comes with its
// date at MIDNIGHT EASTERN - 2026-10-11T04:00:00Z for an unplaced LCS game, and
// 6 Oct's MIL@SD sat on October board 42 as 04:00Z (9 PM PDT the night before)
// until the real 01:30Z posted. No MLB game is scheduled at 00:00 ET, so that
// instant IS the flag: it is stored as matches.metadata.kickoff_tbd = true and
// never read as a real first pitch - no lock, no clock, "Time TBD" on screen.

const ET_HM = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Is this instant exactly 00:00:00 Eastern - the provider's "no time yet"? */
export function isPlaceholderKickoff(iso) {
  if (iso == null) return false;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return false;
  return ET_HM.format(d) === '00:00:00';
}

export { TIME_TBD } from '../time/display.js';

/**
 * Is this match row's first pitch unset? metadata.kickoff_tbd === true (the
 * stored flag, written for MLB and - since wed-6 - CFB, lib/gridiron/cfbKickoffTbd.js), or - for an MLB row - the kickoff_at
 * itself is the midnight-ET placeholder. Tolerates the flat shapes data layers
 * select (kickoff_tbd / kickoffTbd beside kickoff_at). A non-MLB row is never
 * judged by its clock: only the stored flag can make it TBD.
 * @param {object} match
 * @param {{mlb?: boolean}} [opts] mlb: the caller knows this is an MLB row
 */
export function isKickoffTbd(match, opts = {}) {
  if (!match) return false;
  if (match.metadata?.kickoff_tbd === true || match.kickoff_tbd === true || match.kickoffTbd === true) return true;
  const league = match.league_slug ?? match.leagueSlug ?? null;
  if (!(opts.mlb === true || league === 'mlb')) return false;
  return isPlaceholderKickoff(match.kickoff_at ?? match.kickoffAt);
}

/**
 * THE ONE LOCK RULE, every board that seals a pick by a game's first pitch
 * (Pick'em football/NBA/MLB boards, the day boards, the save doors, the
 * settle's late-pick check). A game is LOCKED iff its status has left
 * 'scheduled', OR it is NOT a TBD game and its kickoff has arrived (`<=`, the
 * boundary instant is kicked). A TBD game's kickoff_at is the provider's
 * midnight-ET placeholder, a date and not a time: it never locks on it. It
 * stays pickable until a real time posts (the flag clears and kickoff_at
 * moves) and then locks at that real time - or until its status leaves
 * 'scheduled'. PURE.
 * @param {{status?: string, kickoff_at?: any, kickoffAt?: any}} match
 * @param {Date|string|number} [now]
 * @param {{tbd?: boolean, mlb?: boolean}} [opts] tbd: the caller already knows
 */
export function isGameLocked(match, now = new Date(), opts = {}) {
  if (!match) return true;
  if ((match.status ?? 'scheduled') !== 'scheduled') return true;
  if (opts.tbd === true || isKickoffTbd(match, opts)) return false;
  const t = new Date(match.kickoff_at ?? match.kickoffAt ?? NaN).getTime();
  return !Number.isFinite(t) || t <= new Date(now).getTime();
}
