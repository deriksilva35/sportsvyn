// lib/scores/leagueScoreboards.js — the league scoreboards that became /scores.
// PURE: no Next, no database, no clock. proxy.js and the two route files both
// read it, so the proxy (which a test cannot import) and the fallback page
// (which it can) agree on one destination.
//
// POST-FLIP (tue-12). /nfl/scores and /cfb/scores mounted the same ScoresView
// as /scores with the league pinned. Under the arcade flip there is one board,
// and the league is a chip on it: /scores?sport=nfl. The old routes answer 308
// so every bookmark, share and indexed link lands on the board that is drawn.
//
// THE QUERY RIDES ALONG. ?date=2026-10-04 on /nfl/scores means the same day on
// /scores. sport= is SET, not appended: the path named the league, and a stray
// ?sport=cfb on /nfl/scores must not produce sport=cfb&sport=nfl.

/** Old route -> the sport chip it now means. */
export const LEAGUE_SCOREBOARDS = Object.freeze({
  '/nfl/scores': 'nfl',
  '/cfb/scores': 'cfb',
});

/**
 * The /scores URL (path + query) an old league scoreboard should 308 to, or
 * null when the path is not one of them. `search` is the raw query string,
 * with or without its leading '?'.
 */
export function scoreboardRedirect(pathname, search = '') {
  const p = String(pathname ?? '').replace(/\/+$/, '');
  const sport = LEAGUE_SCOREBOARDS[p];
  if (!sport) return null;
  const q = new URLSearchParams(String(search ?? '').replace(/^\?/, ''));
  q.set('sport', sport);
  return `/scores?${q.toString()}`;
}

/** The same, from a route's awaited searchParams object (the fallback page). */
export function scoreboardRedirectFromParams(pathname, sp = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp ?? {})) {
    for (const one of Array.isArray(v) ? v : [v]) if (one != null) q.append(k, String(one));
  }
  return scoreboardRedirect(pathname, q.toString());
}
