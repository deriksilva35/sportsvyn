// lib/gridiron/gameTabsNav.js - the game page's tab state, as a URL. PURE.
//
// THE scoresNav LAW VERBATIM: one builder, one parser, round-tripped in tests.
// A link must be able to open a specific tab, and a URL must never carry tab
// state the page cannot read. lib/leagues/nav.js says the same thing for the
// league page; this is the same law one level down, not a second builder for
// the same URL - the two address different pages.
//
// THE PANEL KEYS ARE THE PAGE'S, NOT THIS MODULE'S. A CFB game rail is DRIVES
// and PLAYER LINES; an NFL one can be THE BRIEF, SCORING, PLAYER LINES and
// TEAM BOX, and both are built from the panels that actually have data. So the
// parser is handed the keys the page decided to render rather than holding a
// list that would have to be edited every time a panel is added - and a ?tab=
// naming a panel this game does not have falls to the default instead of
// selecting nothing.

/** @returns a key present in `keys`; junk, absent and unavailable all fall to
 *  the first panel, which is the page's default. */
export function parseGameTab(sp = {}, keys = []) {
  const raw = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  return keys.includes(raw) ? raw : (keys[0] ?? null);
}

/**
 * The one sanctioned game-page URL.
 *
 * THE DEFAULT TAB IS OMITTED, not spelled out: one page, one URL. A rail that
 * wrote ?tab=drives on load would give every game two addresses that render
 * identically, and the second one would be the one people shared.
 */
export function gameTabHref(basePath, tab, keys = []) {
  const base = String(basePath ?? '');
  if (!tab || !keys.includes(tab) || tab === keys[0]) return base;
  return `${base}?tab=${encodeURIComponent(tab)}`;
}
