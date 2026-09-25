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
// CFB COMES FROM ITS MANIFEST (lib/teams/cfb-headgear-manifest.json, copied
// unchanged from the batch that made the helmets). Its keys are the printed
// abbreviations of the 138 FBS teams; its `file` field is the file name, which
// differs from the key twice - TA&M -> TAM and M-OH -> MOH - because & and a
// hyphen do not belong in a URL path.
//
// FCS HAS NO HELMETS, AND ITS LETTERS MUST NOT BORROW ONE. An FCS team has no
// stored abbreviation, so the card prints three letters of its name - and
// Alabama A&M prints ALA, which is Alabama's key. The lookup therefore takes
// the STORED abbreviation (every FBS team has one, no FCS team does); a caller
// that only has printed letters passes the stored one as `key` to TeamMark.

import CFB_MANIFEST from './cfb-headgear-manifest.json' with { type: 'json' };

const LIST = {
  nfl: 'ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LAC LAR LV MIA MIN NE NO NYG NYJ PHI PIT SEA SF TB TEN WSH',
  mlb: 'ARI ATL BAL BOS CHC CHW CIN CLE COL DET HOU KC LAA LAD MIA MIL MIN NYM NYY OAK PHI PIT SD SEA SF STL TB TEX TOR WSH',
};

/** league -> Map(abbreviation -> file name). nfl/mlb file names are the key. */
const FILES = Object.freeze({
  ...Object.fromEntries(Object.entries(LIST).map(([league, s]) => [league, new Map(s.split(' ').map((a) => [a, a]))])),
  cfb: new Map(Object.entries(CFB_MANIFEST.cfb ?? {}).map(([abbr, v]) => [abbr, String(v?.file ?? '')]).filter(([, f]) => f)),
});

/** league -> Set(abbreviation), for the list-vs-folder test and anyone asking "does it have one". */
export const HEADGEAR = Object.freeze(Object.fromEntries(
  Object.entries(FILES).map(([league, m]) => [league, Object.freeze(new Set(m.keys()))]),
));

/** @returns {{src1x: string, src2x: string} | null} */
export function headgearFor(leagueSlug, abbr) {
  const files = Object.hasOwn(FILES, String(leagueSlug ?? '')) ? FILES[leagueSlug] : null;
  if (!files || typeof abbr !== 'string' || !files.has(abbr)) return null;
  const base = `/headgear/${leagueSlug}/${files.get(abbr)}`;
  return { src1x: `${base}@1x.webp`, src2x: `${base}@2x.webp` };
}

/** The file name behind an abbreviation (TA&M -> TAM), or null. */
export function headgearFile(leagueSlug, abbr) {
  const files = Object.hasOwn(FILES, String(leagueSlug ?? '')) ? FILES[leagueSlug] : null;
  return files?.get(abbr) ?? null;
}

/**
 * BOTH OR NEITHER. A game's two marks are headgear only when both sides have
 * it; one cutout beside one disc reads as a favourite. Pair surfaces pass the
 * answer to each side's TeamMark as `headgear`.
 */
export function pairHasHeadgear(leagueSlug, abbrA, abbrB) {
  return headgearFor(leagueSlug, abbrA) != null && headgearFor(leagueSlug, abbrB) != null;
}
