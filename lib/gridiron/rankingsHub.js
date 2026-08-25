// lib/gridiron/rankingsHub.js — the per-league rankings-hub tab config + pure
// helpers shared by the hub route and the Today-page previews. No DB.

export const RANKING_TABS = {
  nfl: [
    { key: 'power',       label: 'Power Rankings', list: 'nfl-power',       kind: 'editorial' },
    { key: 'mvp-offense', label: 'MVP Offense',    list: 'nfl-mvp-offense', kind: 'editorial' },
    { key: 'mvp-defense', label: 'MVP Defense',    list: 'nfl-mvp-defense', kind: 'editorial' },
    { key: 'playoff',     label: 'Playoff Picture', kind: 'market', n: 12 },
  ],
  cfb: [
    // AP and Coaches lead: they are the new content, and AP is the poll that
    // drives Pick'em's inclusion rule. NOTE this makes AP the DEFAULT tab -
    // resolveActiveTab falls back to tabs[0] - so a bare /cfb/rankings now
    // opens on AP rather than the Sportsvyn 25. Deliberate, and the reason the
    // three existing KEYS below are untouched: app/page.js links
    // boardHref('cfb','top25') and would dangle if the key moved with the row.
    { key: 'ap',      label: 'AP Top 25',        poll: 'AP Top 25',   kind: 'poll' },
    { key: 'coaches', label: 'Coaches Poll',     poll: 'Coaches Poll', kind: 'poll' },
    { key: 'top25',   label: 'The Sportsvyn 25', list: 'cfb-top25',   kind: 'editorial' },
    { key: 'heisman', label: 'Heisman',          list: 'cfb-heisman', kind: 'editorial' },
    { key: 'playoff', label: 'Playoff Picture',  kind: 'market', n: 25 },
  ],
};

// The active tab for a ?tab= param, defaulting to the first tab.
export function resolveActiveTab(tabs, param) {
  return (tabs ?? []).find((t) => t.key === param) ?? (tabs ?? [])[0] ?? null;
}

// Preview slice for the Today page (top N by rank; entries arrive rank-ordered).
export function previewEntries(entries, n = 5) {
  return (entries ?? []).slice(0, n);
}

export function darkHorseCount(entries) {
  return (entries ?? []).filter((e) => e.band === 'dark_horse').length;
}

// A board preview's "Full board ->" target: its tab on the league rankings hub.
export function boardHref(leagueSlug, tabKey) {
  return `/${leagueSlug}/rankings?tab=${tabKey}`;
}
