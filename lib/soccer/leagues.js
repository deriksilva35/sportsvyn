// lib/soccer/leagues.js - THE SOCCER LEAGUE REGISTRY (ucl, fri-3). PURE and
// client-safe: no database, no Next.
//
// One entry per competition we carry: our slug, the provider's league id, the
// season (api-football labels a European season by its OPENING year: 2026-27
// = 2026), the names, and how its rounds are worded. Every importer, the live
// poller, the table sync and the scoreboard read this list, so a third league
// is one entry here plus whatever its round names need in roundOf().
//
//   epl  Premier League        Matchweek N
//   ucl  Champions League      Matchday N (league phase), then the knockout
//                              round by name (Round of 16, Quarter-final, ...)

export const SOCCER_LEAGUES = Object.freeze([
  Object.freeze({
    slug: 'epl', apiId: 39, season: 2026,
    name: 'Premier League', shortName: 'Premier League', label: 'EPL',
    seasonType: 'league',
  }),
  Object.freeze({
    slug: 'ucl', apiId: 2, season: 2026,
    name: 'UEFA Champions League', shortName: 'Champions League', label: 'UCL',
    seasonType: 'tournament',
  }),
]);

export const SOCCER_SLUGS = Object.freeze(SOCCER_LEAGUES.map((l) => l.slug));

/** The registry entry for a slug, or null. */
export const soccerLeague = (slug) => SOCCER_LEAGUES.find((l) => l.slug === String(slug ?? '')) ?? null;

/** Is this one of the soccer leagues the board carries? */
export const isSoccerSlug = (slug) => SOCCER_SLUGS.includes(String(slug ?? ''));

/** The league's own pages. */
export const matchHref = (leagueSlug, slug) => `/${leagueSlug}/match/${slug}`;
export const standingsHref = (leagueSlug) => `/${leagueSlug}/standings`;

// ---------------------------------------------------------------------------
// ROUNDS
// ---------------------------------------------------------------------------

/**
 * The Champions League's knockout rounds, the provider's words -> our stage key.
 * Recorded 2 Oct (testdata/ucl/rounds-2025.json): the knockout play-off that
 * follows the league phase (9th-24th) comes back as 'Round of 32'.
 */
export const UCL_KNOCKOUT = Object.freeze({
  'round of 32': 'playoff',
  'knockout round play-offs': 'playoff',
  'round of 16': 'r16',
  'quarter-finals': 'qf',
  'semi-finals': 'sf',
  final: 'final',
});

/** Stage key -> the round's name, as a reader says it. */
export const UCL_STAGE_NAME = Object.freeze({
  playoff: 'Knockout play-off',
  r16: 'Round of 16',
  qf: 'Quarter-final',
  sf: 'Semi-final',
  final: 'Final',
});

/**
 * The provider's round string -> what a matches row stores.
 *   { week, stage }        a round we carry
 *   { skip: true }         a round we deliberately do not (UCL qualifying)
 *   { unknown: true }      a round nobody has ruled on - the sync reports it
 * PURE.
 */
export function roundOf(leagueSlug, round) {
  const r = String(round ?? '').trim();
  if (leagueSlug === 'epl') {
    const m = r.match(/^Regular Season\s*-\s*(\d+)$/i);
    return m ? { week: Number(m[1]), stage: null } : { unknown: true };
  }
  if (leagueSlug === 'ucl') {
    const m = r.match(/^League Stage\s*-\s*(\d+)$/i);
    if (m) return { week: Number(m[1]), stage: 'league' };
    const ko = UCL_KNOCKOUT[r.toLowerCase()];
    if (ko) return { week: null, stage: ko };
    // Qualifying (1st-3rd Qualifying Round, the pre-league 'Play-offs'): the
    // clubs knocked out there never reach the board.
    if (/qualifying|^preliminary|^play-offs$/i.test(r)) return { skip: true };
    return { unknown: true };
  }
  return { unknown: true };
}

// ---------------------------------------------------------------------------
// THE LEAGUE-PHASE TABLE
// ---------------------------------------------------------------------------

/**
 * Where a league-phase position leads (the 2024- format, 36 clubs):
 *   1-8    'r16'      straight to the round of 16
 *   9-24   'playoff'  the knockout play-off
 *   25-36  'out'      eliminated
 * By rank, not by the provider's prose - the bands are the competition's rule.
 */
export function uclBand(rank) {
  const n = Number(rank);
  if (!Number.isInteger(n) || n < 1) return null;
  if (n <= 8) return 'r16';
  if (n <= 24) return 'playoff';
  return 'out';
}

export const UCL_BAND_NAME = Object.freeze({
  r16: 'Round of 16',
  playoff: 'Knockout play-off',
  out: 'Eliminated',
});
