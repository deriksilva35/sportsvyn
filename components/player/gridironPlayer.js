// components/player/gridironPlayer.js - the player page's league-aware bits.
//
// SAME LAW AS THE TEAM PAGE, AND THE SAME NEAR-MISS AVOIDED. Soccer's crumb is
// returned as the LITERAL string it already renders, never reconstructed from
// the league row: doing that on the team page turned "FIFA World Cup 2026" into
// "2026 FIFA World Cup" - identical intent, different words, live regression.
// Preserve, do not rebuild.
//
// The dormant sections are the other half. A soccer player page carries seven
// DormantSection placeholders (Outlook, Awards, Form, Rankings, Stats,
// Trajectory, Articles). For a gridiron player those are not empty, they are
// INAPPLICABLE - "Tournament Stats" is not a thing an NFL tight end has - so
// they are absent from the markup rather than rendered blank.

import { isGridiron, heightImperial, weightImperial } from '../team/gridiron.js';

export { isGridiron };

const LEAGUE_LABEL = { nfl: 'NFL', cfb: 'CFB' };

/**
 * The breadcrumb trail, as an ordered list of {label, href?}.
 *
 * The soccer arm returns exactly what the page rendered before this change:
 * Home / FIFA World Cup 2026 / Players / <name>, with the same hrefs, including
 * the "#" on Players (there is no players index to point at, for any league).
 */
export function playerCrumb(leagueSlug, fullName) {
  const mid = isGridiron(leagueSlug)
    ? { label: LEAGUE_LABEL[leagueSlug], href: `/${leagueSlug}` }
    : { label: 'FIFA World Cup 2026', href: '/world-cup-2026/bracket' };
  return [
    { label: 'Home', href: '/' },
    mid,
    { label: 'Players', href: '#' },
    { label: fullName, current: true },
  ];
}

/** "NFL · Tight End" - the hero eyebrow. */
const POSITION_WORD = {
  QB: 'Quarterback', RB: 'Running Back', FB: 'Fullback', WR: 'Wide Receiver',
  TE: 'Tight End', OL: 'Offensive Lineman', OT: 'Offensive Tackle',
  OG: 'Offensive Guard', C: 'Center', LS: 'Long Snapper', G: 'Guard', T: 'Tackle',
  DL: 'Defensive Lineman', DE: 'Defensive End', DT: 'Defensive Tackle',
  NT: 'Nose Tackle', EDGE: 'Edge Rusher', LB: 'Linebacker', ILB: 'Linebacker',
  OLB: 'Linebacker', MLB: 'Linebacker', DB: 'Defensive Back', CB: 'Cornerback',
  S: 'Safety', FS: 'Safety', SS: 'Safety', SAF: 'Safety',
  K: 'Kicker', PK: 'Kicker', P: 'Punter', ATH: 'Athlete',
};

export function heroEyebrow(leagueSlug, position) {
  const league = LEAGUE_LABEL[leagueSlug] ?? '';
  const word = POSITION_WORD[String(position ?? '').toUpperCase()] ?? position ?? null;
  return [league, word].filter(Boolean).join(' · ');
}

const GROUP_WORD = { OFF: 'Offense', DEF: 'Defense', ST: 'Special Teams' };

/**
 * The hero chips after the team chip.
 *
 * A ROOKIE IS experience_years === 1, not 0 - the importer stores a rookie as
 * season one, because "0 seasons" would sort a rookie below someone who has
 * never played, which is nobody. Anything past year one reads "Yr N"; an
 * unknown year renders no chip at all rather than "Yr null".
 */
export function heroChips({ position, positionGroup, experienceYears }) {
  const chips = [];
  const group = GROUP_WORD[positionGroup];
  const posLine = [position, group].filter(Boolean).join(' · ');
  if (posLine) chips.push({ label: posLine });
  if (experienceYears === 1) chips.push({ label: 'Rookie', rookie: true });
  else if (experienceYears != null) chips.push({ label: `Yr ${experienceYears}` });
  return chips;
}

/**
 * The bio strip cells. A cell with no value is OMITTED, not rendered blank -
 * CFBD ships no college, so a college player legitimately has one fewer cell,
 * the same way their roster tag line is legitimately shorter.
 */
export function bioCells({ heightCm, weightKg, college, jersey }) {
  const ht = heightImperial(heightCm);
  const wt = weightImperial(weightKg);
  const cells = [];
  // Feet-inches with a hyphen here, not 6'4" - the mock's bio strip reads 6-5
  // while the roster row reads 6'4". Same converter, two presentations.
  if (ht) cells.push({ k: 'Height', v: ht.replace(/'/, '-').replace(/"$/, '') });
  if (wt) cells.push({ k: 'Weight', v: `${wt} lbs` });
  if (college) cells.push({ k: 'College', v: college });
  if (jersey != null) cells.push({ k: 'Jersey', v: `#${jersey}` });
  return cells;
}

/**
 * The anchor pills, which render ONLY sections that exist for this player.
 * A player with no stat rows gets a single Team pill - not three pills, two of
 * which scroll to an apology.
 */
export function playerPills({ hasStats, hasLog = hasStats }) {
  const pills = [];
  if (hasStats) pills.push({ href: '#totals', label: 'Season Totals' });
  // A CFB player has season totals but no game log until those are imported.
  // The pill follows the section, not the league.
  if (hasLog) pills.push({ href: '#gamelog', label: 'Game Log' });
  pills.push({ href: '#team', label: 'Team' });
  return pills;
}

/**
 * The one line shown instead of a stats table.
 *
 * DELIBERATELY THE SAME SENTENCE whichever cause applies - a rookie who has not
 * played, a veteran with no rows, or a CFB player whose stats are not imported
 * until relay C. The reader is owed the state of the player, not the state of
 * our pipeline.
 */
export function emptyLogLine({ leagueSlug, experienceYears, seasonYear }) {
  if (leagueSlug === 'nfl' && experienceYears === 1 && seasonYear) {
    return `No NFL games yet - ${seasonYear} is the rookie season. The log starts when the season does.`;
  }
  return 'No recorded games yet. The log starts when the season does.';
}
