// lib/mlb/teamColors.js - MLB team colours, by hand, keyed on the BDL
// abbreviation. PURE: no I/O beyond the writer at the bottom.
//
// WHY A HAND TABLE AND NOT A FEED. The NFL got its colours from nflverse's
// teams_colors_logos.csv and lib/gridiron/teamColors.js reads it. There is no
// equivalent open, licensed table for MLB that this product already has a key
// for, and BDL's /mlb/v1/teams payload carries NO colour at all - probed 22 Sep
// 2026, the row is id, slug, abbreviation, display_name, short_display_name,
// name, location, league, division and nothing else. Thirty rows written once
// is a smaller and more honest thing than an unlicensed scrape.
//
// THESE ARE THE CLUBS' PRIMARY AND SECONDARY MARKS as they appear on the caps
// and the road greys - the same editorial call lib/gridiron/teamColors.js's
// source makes. They are used for the TeamMark disc and the helmet-equivalent,
// so what matters is that the pair reads as the team at 22px and that the two
// are distinguishable from each other. Where a club's two marks are navy and
// red, navy leads.
//
// THE KEY IS THE BDL ABBREVIATION, which is what teams.abbreviation holds for
// this league - the same join lib/gridiron/teamColors.js uses. No mapping
// table is needed here: unlike nflverse, this file was written against the
// abbreviations the database actually has.

const hex = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v ?? '').trim())
  ? `#${String(v).trim().replace('#', '').toUpperCase()}`
  : null);

/** abbreviation -> [primary, secondary]. Thirty rows, one per club. */
export const MLB_COLORS = Object.freeze({
  // American League East
  BAL: ['#DF4601', '#000000'],
  BOS: ['#BD3039', '#0C2340'],
  NYY: ['#0C2340', '#C4CED3'],
  TB:  ['#092C5C', '#8FBCE6'],
  TOR: ['#134A8E', '#1D2D5C'],
  // American League Central
  // CHW, NOT CWS - BDL's own abbreviation for the White Sox, checked against
  // /mlb/v1/teams rather than assumed. The wrong key would have matched no
  // team and the club would have rendered as a bare abbreviation disc.
  CHW: ['#27251F', '#C4CED4'],
  CLE: ['#0C2340', '#E31937'],
  DET: ['#0C2340', '#FA4616'],
  KC:  ['#004687', '#BD9B60'],
  MIN: ['#002B5C', '#D31145'],
  // American League West
  HOU: ['#002D62', '#EB6E1F'],
  LAA: ['#BA0021', '#003263'],
  OAK: ['#003831', '#EFB21E'],
  SEA: ['#0C2C56', '#005C5C'],
  TEX: ['#003278', '#C0111F'],
  // National League East
  ATL: ['#CE1141', '#13274F'],
  MIA: ['#00A3E0', '#EF3340'],
  NYM: ['#002D72', '#FF5910'],
  PHI: ['#E81828', '#002D72'],
  WSH: ['#AB0003', '#14225A'],
  // National League Central
  CHC: ['#0E3386', '#CC3433'],
  CIN: ['#C6011F', '#000000'],
  MIL: ['#12284B', '#FFC52F'],
  PIT: ['#27251F', '#FDB827'],
  STL: ['#C41E3A', '#0C2340'],
  // National League West
  ARI: ['#A71930', '#E3D4AD'],
  COL: ['#33006F', '#C4CED4'],
  LAD: ['#005A9C', '#EF3E42'],
  SD:  ['#2F241D', '#FFC425'],
  SF:  ['#FD5A1E', '#27251F'],
});

/** Pure: the table as rows, validated. Throws on a malformed hex - thirty
 *  hand-typed pairs is exactly where a typo lives, and a silent null would
 *  render as the abbreviation disc and look like a missing team. */
export function mlbColorRows() {
  return Object.entries(MLB_COLORS).map(([abbreviation, [p, s]]) => {
    const primary = hex(p); const secondary = hex(s);
    if (!primary || !secondary) throw new Error(`mlb colours: bad hex for ${abbreviation}`);
    if (primary === secondary) throw new Error(`mlb colours: ${abbreviation} has one colour twice`);
    return { abbreviation, primary, secondary };
  }).sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
}

/** Write them onto the league's teams by abbreviation. Returns what matched. */
export async function syncMlbColors(sql, leagueId) {
  const colors = mlbColorRows();
  let updated = 0;
  for (const c of colors) {
    const r = await sql`
      UPDATE teams SET color_primary = ${c.primary}, color_secondary = ${c.secondary}, updated_at = now()
       WHERE league_id = ${leagueId} AND abbreviation = ${c.abbreviation}
         AND (color_primary IS DISTINCT FROM ${c.primary} OR color_secondary IS DISTINCT FROM ${c.secondary})
       RETURNING id`;
    updated += r.length;
  }
  // WHAT THE TABLE AND THE DATABASE DISAGREE ABOUT, both directions, reported
  // rather than swallowed: a club we have no colour for renders as a bare
  // abbreviation disc, and a colour for a club we do not have is a typo.
  const have = await sql`SELECT abbreviation FROM teams WHERE league_id = ${leagueId}`;
  const inDb = new Set(have.map((t) => t.abbreviation));
  const inTable = new Set(colors.map((c) => c.abbreviation));
  return {
    updated,
    teams: inDb.size,
    missingColour: [...inDb].filter((a) => a && !inTable.has(a)).sort(),
    unmatchedRow: [...inTable].filter((a) => !inDb.has(a)).sort(),
  };
}
