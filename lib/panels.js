// lib/panels.js -- My Sportsvyn panel REGISTRY (pure, serializable metadata).
//
// Single source of truth for the 12-panel registry. This file holds ONLY
// serializable metadata: no component refs, no functions, no reader imports.
// That keeps it safe to import into a client component (the customize UI),
// which must not pull server readers into its bundle. The server-side bindings
// (Component + data loader per panel) live in lib/panelLoaders.js.
//
// Per entry: name, desc, tier ('free' | 'member'), group ('core' | 'more' |
// 'member'), span (default column span out of 12), conditional (optional; the
// panel only renders when its loader returns content, e.g. Live Now in play).
// The object key is the panel id.

export const PANELS = {
  // MY CONTESTS leads: the four games are the reason to open this page, and a
  // dashboard that opens with a ranking is a magazine.
  contests:   { name: 'My Contests',   desc: 'Daily, Pick\u2019em, Weekly and Draft in one card.',   tier: 'member', group: 'core',   span: 12 },
  pickem:     { name: 'My Pick\u2019em',    desc: 'Your picks, and what is still open.',                   tier: 'member', group: 'core',   span: 12 },
  fantasy:    { name: 'My Fantasy',    desc: 'Recent mock drafts and your exposure.',                tier: 'member', group: 'core',   span: 12 },
  movers:     { name: 'ADP Movers',    desc: 'The sharpest 3-day ADP moves, PPR 12.',                 tier: 'member', group: 'core',   span: 12 },
  today:      { name: 'Today & Next',  desc: "Your leagues' games today and next.",                   tier: 'free',   group: 'core',   span: 12 },
  live:       { name: 'Live Now',      desc: 'Games in play right now, any league.',                  tier: 'free',   group: 'core',   span: 12 },
  watch:      { name: 'Watch Scores',  desc: 'The slate, filterable by league.',                      tier: 'free',   group: 'more',   span: 12 },
  rankings:   { name: 'AP Top 25',     desc: 'The AP poll, top five.',                                tier: 'free',   group: 'more',   span: 12 },
  schedule:   { name: 'Your Schedule', desc: 'Next games for the teams you follow.',                  tier: 'free',   group: 'more',   span: 12 },
  players:    { name: 'Your Players',  desc: 'Recent lines for the players you follow.',              tier: 'free',   group: 'more',   span: 12 },
};

// RETIRED IN PHASE 1, and why, so nobody re-adds them by reflex:
//   goldenboot  player_tournament_stats has 0 rows - it rendered nothing in any
//               league, WC included
//   groups      group standings are a World Cup group-stage concept with no
//               gridiron or league-table analogue
//   mentioned   WC-scoped editorial join; no gridiron equivalent yet
//   market      UNREGISTERED, NOT DELETED. odds_markets holds 1.36M NFL and
//               619k CFB rows refreshed every 15 minutes - richer and fresher
//               than anything else here - but getModelBoard/getTotalsBoard/
//               getLedger are still WC-scoped. Retargeting it is Phase 1.5, so
//               every lib and component file stays on disk.
//   form,       registry lines that never had a loader or a component. Deleting
//   storylines  two lines of metadata, not a feature.

// Registry default active list, in render order. A user with no user_dashboards
// row falls back to this set.
export const DEFAULT_ACTIVE = [
  'contests', 'pickem', 'fantasy', 'movers', 'today', 'live', 'watch',
  'rankings', 'schedule', 'players',
];

// Library grouping for the customize UI: the order the groups appear, and their
// display labels.
// 'member' is gone from the order because no panel carries that group any
// more - the two that did (form, storylines) were registry lines with no
// loader and no component. A declared group with no members renders an empty
// heading in the customize library.
export const GROUP_ORDER = ['core', 'more'];
export const GROUP_LABELS = {
  core:   'Default panels',
  more:   'More panels',
};
