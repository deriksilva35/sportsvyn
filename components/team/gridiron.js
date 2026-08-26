// components/team/gridiron.js - the gridiron team page's league-aware bits.
//
// EVERY EXPORT HERE IS GATED ON LEAGUE. The team page is shared with soccer,
// and soccer's breadcrumb, five-pill rail and squad rendering are correct as
// they stand - so nothing below may change what a World Cup team renders. The
// tests pin both sides.

export const GRIDIRON = new Set(['nfl', 'cfb']);
export const isGridiron = (leagueSlug) => GRIDIRON.has(String(leagueSlug ?? ''));

/**
 * THE BREADCRUMB. It was hardcoded to "FIFA World Cup 2026" linking to the WC
 * bracket - on ALL 275 gridiron team pages, telling a reader the Kansas City
 * Chiefs play in the World Cup. League-aware now; soccer keeps its exact
 * previous crumb because the fallback returns the same label and href.
 */
export function breadcrumbFor(leagueSlug) {
  if (leagueSlug === 'nfl') return { label: 'NFL', href: '/nfl' };
  if (leagueSlug === 'cfb') return { label: 'CFB', href: '/cfb' };
  // THE SOCCER FALLBACK IS THE LITERAL PREVIOUS STRING, not the league's name
  // from the database. Passing leagueName through changed Argentina's crumb
  // from "FIFA World Cup 2026" to "2026 FIFA World Cup" - a soccer regression
  // in a gridiron-only relay. Caught by diffing the served page, not by review.
  return { label: 'FIFA World Cup 2026', href: '/world-cup-2026/bracket' };
}

/**
 * THE ANCHOR RAIL. Four of soccer's seven pills pointed at sections that do not
 * exist for gridiron - #stats, #players, #squad, #trajectory - so a third of
 * the navigation on every NFL and CFB team page went nowhere. Gridiron gets
 * pills for the sections it actually renders; soccer's seven are untouched.
 */
export function anchorPillsFor(leagueSlug) {
  if (isGridiron(leagueSlug)) {
    return [
      { href: '#matches', label: 'Recent + Next' },
      { href: '#squad', label: 'Roster' },
      { href: '#schedule', label: 'Schedule' },
      { href: '#articles', label: 'Articles' },
    ];
  }
  return [
    { href: '#matches', label: 'Recent + Next' },
    { href: '#stats', label: 'Team Stats' },
    { href: '#players', label: 'Top Players' },
    { href: '#squad', label: 'Squad' },
    { href: '#trajectory', label: 'Trajectory' },
    { href: '#schedule', label: 'Schedule' },
    { href: '#articles', label: 'Articles' },
  ];
}

/**
 * "Full Tournament" is not what an NFL season is called.
 *
 * SOCCER GETS NULL, NOT THE STRING IT ALREADY RENDERS. Returning the literal
 * 'Full Tournament' looked harmless - the visible text was identical - but it
 * pushed soccer down the passed-heading branch and out of Schedule's fallback,
 * which is where the markup lives:
 *     Full <span class="accent">Tournament</span>   ->   Full Tournament
 * Same words, and "Tournament" silently lost its accent colour on every World
 * Cup team page. Null keeps soccer on the original branch, byte for byte.
 *
 * The gridiron heading is a PAIR rather than a string for the same reason:
 * every other section head on this page is "lead + accented tail" (Power
 * Ranking / Over Time, Tournament / to Date, The / 95), so a flat string would
 * have been the only unaccented heading on the page.
 */
export function scheduleHeadingFor(leagueSlug, seasonYear) {
  if (!isGridiron(leagueSlug)) return null;
  return seasonYear ? { lead: String(seasonYear), accent: 'Season' }
                    : { lead: '', accent: 'Season' };
}

// ---------------------------------------------------------------- display

/**
 * cm -> ft'in". Stored metric (migration 076, because height_cm predates this
 * work); shown imperial, because a US football audience reads 6'2" and not
 * 188cm. Display-only - storage is untouched.
 */
export function heightImperial(cm) {
  if (cm == null) return null;
  const totalIn = Math.round(Number(cm) / 2.54);
  if (!Number.isFinite(totalIn) || totalIn <= 0) return null;
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
}

/** kg -> lb, rounded. */
export function weightImperial(kg) {
  if (kg == null) return null;
  const lb = Math.round(Number(kg) / 0.45359237);
  return Number.isFinite(lb) && lb > 0 ? String(lb) : null;
}

/**
 * "QB · Texas Tech · yr9" for the NFL, "LS · yr3" for college.
 *
 * CFBD SHIPS NO COLLEGE - null by design, since for a college player the team
 * IS the college. So the segment is omitted rather than rendered as an empty
 * gap between two separators. A CFB row is legitimately thinner than an NFL
 * one; that is the data, not a defect.
 */
export function tagLine({ position, college, experienceYears }) {
  return [position, college, experienceYears != null ? `yr${experienceYears}` : null]
    .filter(Boolean).join(' · ');
}

// The three real groups plus the honest fourth. Order is how a roster reads.
export const GRIDIRON_GROUPS = [
  { key: 'OFF', label: 'Offense' },
  { key: 'DEF', label: 'Defense' },
  { key: 'ST', label: 'Special Teams' },
  { key: null, label: 'Unlisted' },
];

/**
 * Group a gridiron roster. The UNLISTED bucket is only returned when the team
 * actually has players in it: 379 rows league-wide carry no position from
 * CFBD, ALL of them college, and zero NFL teams have any - so an unconditional
 * group would put an empty "Unlisted" header on all 32 NFL team pages.
 */
export function groupRoster(players) {
  const out = [];
  for (const { key, label } of GRIDIRON_GROUPS) {
    const members = (players ?? []).filter((p) => (p.position_group ?? null) === key);
    if (!members.length) continue;
    members.sort((a, b) => {
      const ja = a.current_team_jersey_number, jb = b.current_team_jersey_number;
      if (ja == null && jb == null) return String(a.full_name).localeCompare(String(b.full_name));
      if (ja == null) return 1;
      if (jb == null) return -1;
      return ja - jb || String(a.full_name).localeCompare(String(b.full_name));
    });
    out.push({ key, label, members, count: members.length });
  }
  return out;
}
