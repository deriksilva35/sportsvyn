// lib/gridiron/leagueNav.js — where a league page can go, and which door it is.
// PURE: no JSX, no database, no clock.
//
// ONE DESTINATION LIST. Before v0.5 the same set of tabs was written out in four
// places - NFL_TABS in app/nfl/page.js, CFB_TABS in app/cfb/page.js, a TABS
// const in each standings route, and a hardcoded <nav> inside RankingsHub - and
// three of the four had already drifted: the rankings hub offered three
// destinations, the CFB landing four, the NFL landing five. A reader who
// tapped Rankings lost the ability to reach Standings. The pill row reads THIS
// and nothing else.
//
// A PILL WHOSE ROUTE DOES NOT EXIST IS ABSENT, NOT DISABLED. A greyed-out door
// still tells you there is a room; an absent one is the truth for a league that
// has no such page. `leagues` on each entry is that answer, and it is data
// rather than a branch so adding /cfb/fantasy is an edit here and nowhere else.

/**
 * THE ORDER IS THE MOCK'S, and it is a claim about what people tap: Scores
 * first because it is the most-used door on the whole product, then the
 * standings-shaped pages, then the tools.
 *
 * EVERY HREF IS LEAGUE-SCOPED. Scores goes to /nfl/scores, never /scores:
 * inside a league the league does not disappear, and the old pill dropped the
 * reader onto the network board where the header was gone and the only way
 * back was the browser button.
 *
 * TWO DESTINATIONS ARE NOT LISTED, both for the same reason - a pill is a
 * door, and neither has a room behind it yet:
 *   READS  there is no /nfl/reads or /cfb/reads route at all.
 *   STATS  /stats exists, but it is the WORLD CUP stats page - hardcoded to
 *          league 'fifa-wc-2026', serving goal scorers, assists and
 *          discipline. It was on this list for one relay and pointed an NFL
 *          reader at soccer scoring leaders. There is no gridiron stats
 *          surface to point at yet, and /nfl/stats rendering a World Cup
 *          table would be worse than an absent pill.
 * Both join the day their route does, and the filesystem test below will then
 * require the route to exist.
 */
export const LEAGUE_NAV = Object.freeze([
  { key: 'scores', label: 'Scores', href: (l) => `/${l}/scores`, leagues: ['nfl', 'cfb'] },
  { key: 'rankings', label: 'Rankings', href: (l) => `/${l}/rankings`, leagues: ['nfl', 'cfb'] },
  { key: 'standings', label: 'Standings', href: (l) => `/${l}/standings`, leagues: ['nfl', 'cfb'] },
  { key: 'market', label: 'Market', href: (l) => `/${l}/market`, leagues: ['nfl', 'cfb'] },
  { key: 'fantasy', label: 'Fantasy', href: (l) => `/${l}/fantasy`, leagues: ['nfl'] },
]);

/**
 * WHICH PILL IS THE PAGE YOU ARE ON, resolved FROM THE ROUTE.
 *
 * Not from a prop each page remembers to pass. That is how the old sub-nav
 * ended up with a landing marked `active: true` on one league and nothing
 * marked on the other: an `active` flag is a fact about the URL that was being
 * restated by hand in six files, and hands forget.
 *
 * THE LANDING FILLS NO PILL. On /nfl the title IS Today, so a filled pill would
 * be a second answer to a question the h1 already answered.
 */
export function currentNavKey(pathname, leagueSlug) {
  const p = String(pathname ?? '').split('?')[0].replace(/\/+$/, '') || '/';
  if (p === `/${leagueSlug}`) return null;              // the landing
  for (const item of LEAGUE_NAV) {
    if (!item.leagues.includes(leagueSlug)) continue;
    const href = item.href(leagueSlug);
    if (p === href || p.startsWith(`${href}/`)) return item.key;
  }
  return null;
}

/**
 * The pills for one league on one route.
 *
 * NO PILL IS BOTH OUTLINED AND FILLED. Scores carries the volt outline as the
 * most-tapped door, but only while it is NOT the page you are on - on /scores
 * it is filled like any other current pill, and wearing both would be two
 * different claims in one shape.
 */
export function navPills(leagueSlug, pathname) {
  const current = currentNavKey(pathname, leagueSlug);
  return LEAGUE_NAV
    .filter((i) => i.leagues.includes(leagueSlug))
    .map((i) => ({
      key: i.key,
      label: i.label,
      href: i.href(leagueSlug),
      current: i.key === current,
      outlined: i.key === 'scores' && current !== 'scores',
    }));
}
