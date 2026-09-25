// lib/teams/headgear.js - the one reader for a team's headgear cutout.
//
// headgearFor(leagueSlug, abbr) -> { src1x, src2x } or null. The files are
// public/headgear/<league>/<ABBR>@1x.webp (96 px) and @2x.webp (192 px), cut on
// the Mac and copied in unchanged; nothing here or anywhere on the server makes
// or resizes an image.
//
// THE LEAGUE IS AN ARGUMENT, NEVER A GUESS. ATL is the Falcons in nfl and the
// Braves in mlb, and the same three letters point at two different files. A
// caller that does not know its league gets null, and TeamMark draws the disc.
//
// A LIST, NOT A STAT. TeamMark renders in client components too, so "is the
// file there" cannot be asked of the disk at render time. The abbreviations are
// written out here, and lib/teams/headgear.test.mjs walks public/headgear/ and
// holds this list and the directory to each other in both directions - a file
// with no entry, or an entry with no file, is a red suite, not a broken image.
//
// nfl and mlb only. cfb has no cutouts yet; its batch adds a key here and files
// beside the others, and nothing else changes.

const LIST = {
  nfl: 'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WSH',
  mlb: 'ARI ATL BAL BOS CHC CHW CIN CLE COL DET HOU KC LAA LAD MIA MIL MIN NYM NYY OAK PHI PIT SD SEA SF STL TB TEX TOR WSH',
};

export const HEADGEAR = Object.freeze(Object.fromEntries(
  Object.entries(LIST).map(([league, s]) => [league, Object.freeze(new Set(s.split(' ')))]),
));

/** @returns {{src1x: string, src2x: string} | null} */
export function headgearFor(leagueSlug, abbr) {
  const set = Object.hasOwn(HEADGEAR, String(leagueSlug ?? '')) ? HEADGEAR[leagueSlug] : null;
  if (!set || typeof abbr !== 'string' || !set.has(abbr)) return null;
  const base = `/headgear/${leagueSlug}/${abbr}`;
  return { src1x: `${base}@1x.webp`, src2x: `${base}@2x.webp` };
}

/**
 * BOTH OR NEITHER. A game's two marks are headgear only when both sides have
 * it; one cutout beside one disc reads as a favourite. Pair surfaces pass the
 * answer to each side's TeamMark as `headgear`.
 */
export function pairHasHeadgear(leagueSlug, abbrA, abbrB) {
  return headgearFor(leagueSlug, abbrA) != null && headgearFor(leagueSlug, abbrB) != null;
}
