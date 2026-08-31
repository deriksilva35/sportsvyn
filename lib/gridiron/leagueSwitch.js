// lib/gridiron/leagueSwitch.js — switching league without losing your place.
// PURE: no JSX, no database.
//
// THE SECTION SURVIVES THE SWITCH. Standing on /nfl/scores and choosing CFB
// lands on /cfb/scores, not on the CFB landing. A switcher that always dropped
// you at the front door would make every cross-league comparison a four-tap
// round trip, and comparing two codes on the same surface is the entire reason
// somebody opens this control.
//
// AND WHERE THERE IS NO COUNTERPART, THE LANDING IS THE HONEST ANSWER. /cfb has
// no fantasy page, so NFL fantasy -> CFB goes to /cfb rather than to a 404 or
// to a disabled row. Same absent-not-disabled rule the pills keep.

import { LEAGUE_NAV, currentNavKey } from './leagueNav.js';
import { NAV } from '../nav.js';

/**
 * THE THREE ROWS, in the order the sheet draws them.
 *
 * SOCCER IS NOT A GRIDIRON LEAGUE and never resolves a section: it has its own
 * surfaces with their own grammar, so every switch to it lands on its front
 * door. Saying so here rather than letting the resolver discover it by failing
 * to match.
 *
 * AND THE FRONT DOOR IS NOT HAND-WRITTEN. It is read from NAV, which already
 * holds it - there is no app/epl/page.js, and soccer's door has been
 * /epl/standings since the World Cup ended. I shipped '/epl' here from memory
 * in the switcher relay and it was a 404 on every SOCCER row for two days; a
 * status sweep found it, no test could have, because the test asserted the
 * same wrong string the source did. Two copies of a destination is how that
 * happens, so now there is one.
 */
const SOCCER_HOME = NAV.find((n) => n.key === 'soccer').href;

export const SWITCHER_LEAGUES = Object.freeze([
  { slug: 'nfl', label: 'NFL' },
  { slug: 'cfb', label: 'CFB' },
  { slug: 'epl', label: 'SOCCER', standalone: true, home: SOCCER_HOME },
]);

/**
 * Where does `target` sit, given you are standing on `pathname` in `from`?
 *
 * The section is read with the nav's OWN resolver rather than by parsing the
 * path again - one answer to "which section is this", shared with the pills.
 */
export function switchTo(pathname, from, target) {
  const row = SWITCHER_LEAGUES.find((l) => l.slug === target);
  if (!row) return null;
  if (row.standalone) return row.home;

  const key = currentNavKey(pathname, from);
  // The landing, or a page outside the nav set: the target's landing.
  if (!key || key === 'today') return `/${target}`;

  const item = LEAGUE_NAV.find((i) => i.key === key);
  // A section the target league does not have - fantasy on CFB - is the
  // landing, not a dead link.
  if (!item || !item.leagues.includes(target)) return `/${target}`;
  return item.href(target);
}

/** Every row the sheet needs, resolved for one position. */
export function switcherRows(pathname, from) {
  return SWITCHER_LEAGUES.map((l) => ({
    slug: l.slug,
    label: l.label,
    href: switchTo(pathname, from, l.slug),
    current: l.slug === from,
  }));
}
