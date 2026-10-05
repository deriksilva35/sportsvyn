// lib/games/howItWorks.js - the explainer's game list, from the registry
// (sun-16 D). PURE over the entries it is handed (no imports): the page
// passes listedGames(), the tests pass fixtures. app/games/how-it-works/page.js may
// not export helpers itself (a page file exports the page and its config), so
// they live here.

// THE LEAGUE WORDS for the list's group heads. 'all' is The Daily's: it runs every day of the year.
const SPORT_WORD = Object.freeze({
  nfl: 'NFL', cfb: 'College football', mlb: 'MLB', nba: 'NBA', epl: 'Premier League', all: 'Every day',
});
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen'];
const word = (n) => WORDS[n] ?? String(n);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The intro line, counted from the registry: "Eleven games across five sports." */
export function introLine(games) {
  const sports = new Set(games.map((g) => g.sport).filter((s) => s !== 'all'));
  return `${cap(word(games.length))} game${games.length === 1 ? '' : 's'} across ${word(sports.size)} sport${sports.size === 1 ? '' : 's'}. All free, an email and a handle.`;
}

/** The list, grouped by sport in registry order. */
export function gameGroups(games, now = new Date()) {
  const groups = [];
  for (const g of games) {
    let grp = groups.find((x) => x.sport === g.sport);
    if (!grp) { grp = { sport: g.sport, label: SPORT_WORD[g.sport] ?? g.sport.toUpperCase(), games: [] }; groups.push(grp); }
    grp.games.push({
      key: g.key, mark: g.mark, name: g.name, about: g.about, href: g.href,
      seasonal: !inSeason(g, now), seasonWords: g.season?.words ?? null,
    });
  }
  return groups;
}

/**
 * Is `now` inside the entry's season? A null season is every day. The window
 * is month-day in America/New_York and may wrap the new year (NFL: September
 * to February). PURE.
 */
export function inSeason(entry, now = new Date()) {
  const s = entry?.season;
  if (!s) return true;
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(now)).reduce((a, x) => (a[x.type] = x.value, a), {});
  const md = `${p.month}-${p.day}`;
  return s.from <= s.to ? (md >= s.from && md <= s.to) : (md >= s.from || md <= s.to);
}
