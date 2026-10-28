// lib/gridiron/heroName.js - the team name the CFB game header prints
// (relay thu-2). PURE.
//
// THE PROBLEM: at 390px the scoreboard hero ellipsises a long school name
// ("WESTERN KENT..."). The hero row gives the name what is left after the
// helmet, abbreviation, record and score, which is about 12 characters at the
// hero's display size.
//
// NO STORED SHORT NAME EXISTS. Read from PROD (243 CFB teams): teams.short_name
// equals teams.name on every row, metadata holds only {classification} and
// external_ids only cfbd_team_id, so there is nothing to prefer. The rule is
// therefore derived, in order, and stops at the first form that fits:
//   1. the name itself, when it is <= HERO_NAME_MAX characters
//   2. the usual newspaper abbreviations: a leading Western/Eastern/Northern/
//      Southern -> W./E./N./S., Southeast/Northeast/... -> SE/NE/..., and a
//      trailing "State" -> "St."   ("Western Kentucky" -> "W. Kentucky")
//   3. the stored abbreviation, if the abbreviated name still does not fit
//   4. the abbreviated name, left to the CSS ellipsis as a last resort
//
// WHY A CHARACTER THRESHOLD AND NOT CSS: the swap has to be decided where the
// name is chosen. Rendering both and switching with a container query would
// put a second name in the DOM for every reader and a CSS change (and a
// parity-intent reset) behind a decision that is one comparison. The cost is
// that desktop also gets the short form for the same teams; the full name stays
// in the title attribute / aria text.

export const HERO_NAME_MAX = 12;

const DIRECTION = { Western: 'W.', Eastern: 'E.', Northern: 'N.', Southern: 'S.' };
const COMPASS = { Southeast: 'SE', Southwest: 'SW', Northeast: 'NE', Northwest: 'NW' };

export function shortSchoolName(name) {
  const n = String(name ?? '').trim();
  if (!n) return n;
  const parts = n.split(/\s+/);
  if (parts.length > 1) {
    if (DIRECTION[parts[0]]) parts[0] = DIRECTION[parts[0]];
    else if (COMPASS[parts[0]]) parts[0] = COMPASS[parts[0]];
    if (parts.at(-1) === 'State') parts[parts.length - 1] = 'St.';
  }
  return parts.join(' ');
}

/** The name the hero prints for a team ({ name, abbreviation }). */
export function heroName(team, max = HERO_NAME_MAX) {
  const name = team?.name ?? null;
  if (!name || name.length <= max) return name;
  const short = shortSchoolName(name);
  if (short.length <= max) return short;
  const ab = team?.abbreviation;
  return ab && ab.length <= 5 ? ab : short;
}
