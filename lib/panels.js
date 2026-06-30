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
  today:      { name: 'Today & Next',   desc: "Your teams' game today and the next two.",         tier: 'free',   group: 'core',   span: 4 },
  schedule:   { name: 'Your Schedule',  desc: 'Forward fixtures, all followed teams, merged.',     tier: 'free',   group: 'core',   span: 8 },
  groups:     { name: 'Your Groups',    desc: 'Group standings for the groups your teams are in.',  tier: 'free',   group: 'core',   span: 5 },
  mentioned:  { name: 'Mentioned',      desc: 'Stories that feature your teams.',                   tier: 'free',   group: 'core',   span: 7 },
  live:       { name: 'Live Now',       desc: 'Appears only when a followed team is playing.',      tier: 'free',   group: 'core',   span: 4, conditional: true },
  watch:      { name: 'Watch Scores',   desc: "Watchability score for today's matches.",           tier: 'free',   group: 'more',   span: 4 },
  rankings:   { name: 'Rankings',       desc: 'Where your teams sit in the power rankings.',        tier: 'free',   group: 'more',   span: 4 },
  goldenboot: { name: 'Golden Boot',    desc: 'Top-scorer race across the tournament.',             tier: 'free',   group: 'more',   span: 4 },
  players:    { name: 'Your Players',   desc: 'Followed players and their output. Needs player follows.', tier: 'free', group: 'more', span: 4 },
  form:       { name: 'Form',           desc: 'Last five results for each followed team.',          tier: 'member', group: 'member', span: 4 },
  storylines: { name: 'Key Storylines', desc: 'Editorial threads following your teams.',            tier: 'member', group: 'member', span: 8 },
  market:     { name: 'The Market',     desc: 'De-vigged consensus as information. No pick, no book.', tier: 'member', group: 'member', span: 4 },
};

// Registry default active list, in render order. A user with no user_dashboards
// row falls back to this set.
export const DEFAULT_ACTIVE = ['today', 'schedule', 'groups', 'mentioned', 'live'];

// Library grouping for the customize UI: the order the groups appear, and their
// display labels.
export const GROUP_ORDER = ['core', 'more', 'member'];
export const GROUP_LABELS = {
  core:   'Default panels',
  more:   'More panels',
  member: 'Founding Member panels',
};
