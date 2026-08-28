// lib/shell/sportsvynTabs.js — the Sportsvyn area's tab vocabulary.
//
// PLAIN MODULE, NOT THE COMPONENT. SportsvynSegment.js is JSX and cannot be
// imported by node --test, so a tab list living there is untestable by
// construction - the same reason topMovers sits beside cardLists and barsFor
// beside the chart. It also gives BackToAppBar somewhere to read the roots
// from that is not a client component.
//
// FOUR TABS, and the order is the reading order of the app: what is happening
// now, what the scores are, what the drafters are doing, what the books are
// doing.
//
// "LIVE SCORES" IS NOW "SCOREBOARD". The old label promised live and delivered
// a slate that is mostly scheduled or final; the web has called this surface
// the Scoreboard since it shipped, and two names for one page is something a
// reader has to learn for no reason.
//
// FANTASY KEEPS ITS TARGET. /nfl/fantasy is the Movement Board, which is what
// "Fantasy" has meant in this shell since the segment shipped - renaming the
// tab beside it is not a licence to move it.

export const TABS = [
  { key: 'today', label: 'Today', href: '/' },
  { key: 'scores', label: 'Scoreboard', href: '/scores' },
  { key: 'fantasy', label: 'Fantasy', href: '/nfl/fantasy' },
  { key: 'market', label: 'Market', href: '/market' },
];

/** The four hrefs, for anything that needs to know "am I at a tab root". */
export const TAB_ROOTS = new Set(TABS.map((t) => t.href));

/**
 * Which tab owns a path. LONGEST PREFIX, so /nfl/fantasy wins over a bare
 * /nfl, and the root only ever matches itself - a startsWith('/') test would
 * light TODAY on every page in the app.
 */
export function activeTab(pathname) {
  const p = pathname || '/';
  if (p === '/') return 'today';
  let best = null;
  for (const t of TABS) {
    if (t.href === '/') continue;
    if (p === t.href || p.startsWith(`${t.href}/`)) {
      if (!best || t.href.length > best.href.length) best = t;
    }
  }
  return best?.key ?? null;
}
