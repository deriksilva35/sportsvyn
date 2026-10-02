// lib/draft/matchup.js - THIS WEEK'S OPPONENT ON A PICK-LIST ROW (thu-25).
//
// A ranked room drafts ONE week, and the question a reader asks of a player
// on that list is "who does he play, and when" - "@KC · Sun 1:00 PM". The
// week's games are already loaded for the room (rankedWindowFor ->
// weekTeamGames, which orients every game to the keyed team), so this is a
// reshaping of data the room already has, not a new read.
//
// PLAIN DATA ACROSS THE SERVER/CLIENT LINE. weekTeamGames returns a Map whose
// kickoffAt may be a Date; a client component's props must be serialisable,
// so the server hands the room a plain object keyed by team abbreviation with
// the kickoff as an ISO string. The TIME is never formatted here: the row
// renders it through StandaloneTime, the site's one viewer-zone formatter.
//
// A PRACTICE MOCK HAS NO WEEK and gets null - the row then says nothing at
// all about an opponent, rather than a blank or a dash.

/**
 * @param {Map<string, {opp?: string|null, home?: boolean, kickoffAt?: Date|string|null}>|null} gamesByTeam
 * @returns {Record<string, {opp: string, home: boolean, kickoffAt: string|null}>|null}
 */
export function weekMatchups(gamesByTeam) {
  if (!gamesByTeam || typeof gamesByTeam.entries !== 'function' || !gamesByTeam.size) return null;
  const out = {};
  for (const [abbr, g] of gamesByTeam.entries()) {
    if (!abbr || !g?.opp) continue;
    const k = g.kickoffAt == null ? null : new Date(g.kickoffAt);
    out[abbr] = {
      opp: g.opp,
      home: g.home === true,
      kickoffAt: k && !Number.isNaN(k.getTime()) ? k.toISOString() : null,
    };
  }
  return Object.keys(out).length ? out : null;
}

/** "@KC" away, "vs KC" at home; null when there is no game to name. */
export function oppLabel(m) {
  if (!m?.opp) return null;
  return m.home ? `vs ${m.opp}` : `@${m.opp}`;
}

/** The matchup for a pool player, or null (no week, no team, a bye). */
export function matchupFor(matchups, team) {
  if (!matchups || !team) return null;
  return matchups[team] ?? null;
}
