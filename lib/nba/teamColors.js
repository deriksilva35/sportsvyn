// lib/nba/teamColors.js - NBA team colours, by hand, keyed on the BDL
// abbreviation. PURE except for the writer at the bottom. Same posture as
// lib/mlb/teamColors.js: BDL's /nba/v1/teams carries no colour at all
// (id, conference, division, city, name, full_name, abbreviation - probed
// 1 Oct 2026), and thirty pairs written once is smaller and more honest than a
// scrape. The primary leads; where a club's marks are a dark and a bright, the
// dark leads so the TeamMark disc reads at 22px.

const hex = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v ?? '').trim())
  ? `#${String(v).trim().replace('#', '').toUpperCase()}`
  : null);

/** abbreviation -> [primary, secondary]. Thirty rows, one per franchise. */
export const NBA_COLORS = Object.freeze({
  // East - Atlantic
  BOS: ['#007A33', '#BA9653'],
  BKN: ['#000000', '#FFFFFF'],
  NYK: ['#006BB6', '#F58426'],
  PHI: ['#006BB6', '#ED174C'],
  TOR: ['#CE1141', '#000000'],
  // East - Central
  CHI: ['#CE1141', '#000000'],
  CLE: ['#860038', '#FDBB30'],
  DET: ['#C8102E', '#1D42BA'],
  IND: ['#002D62', '#FDBB30'],
  MIL: ['#00471B', '#EEE1C6'],
  // East - Southeast
  ATL: ['#E03A3E', '#C1D32F'],
  CHA: ['#1D1160', '#00788C'],
  MIA: ['#98002E', '#F9A01B'],
  ORL: ['#0077C0', '#C4CED4'],
  WAS: ['#002B5C', '#E31837'],
  // West - Northwest
  DEN: ['#0E2240', '#FEC524'],
  MIN: ['#0C2340', '#236192'],
  OKC: ['#007AC1', '#EF3B24'],
  POR: ['#E03A3E', '#000000'],
  UTA: ['#002B5C', '#F9A01B'],
  // West - Pacific
  GSW: ['#1D428A', '#FFC72C'],
  LAC: ['#C8102E', '#1D428A'],
  LAL: ['#552583', '#FDB927'],
  PHX: ['#1D1160', '#E56020'],
  SAC: ['#5A2D81', '#63727A'],
  // West - Southwest
  DAL: ['#00538C', '#002B5E'],
  HOU: ['#CE1141', '#000000'],
  MEM: ['#5D76A9', '#12173F'],
  NOP: ['#0C2340', '#C8102E'],
  SAS: ['#000000', '#C4CED4'],
});

/** Pure: the table as rows, validated. Throws on a malformed or doubled hex. */
export function nbaColorRows() {
  return Object.entries(NBA_COLORS).map(([abbreviation, [p, s]]) => {
    const primary = hex(p); const secondary = hex(s);
    if (!primary || !secondary) throw new Error(`nba colours: bad hex for ${abbreviation}`);
    if (primary === secondary) throw new Error(`nba colours: ${abbreviation} has one colour twice`);
    return { abbreviation, primary, secondary };
  }).sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
}

/** Write them onto the league's teams by abbreviation. Returns what matched. */
export async function syncNbaColors(sql, leagueId) {
  const colors = nbaColorRows();
  let updated = 0;
  for (const c of colors) {
    const r = await sql`
      UPDATE teams SET color_primary = ${c.primary}, color_secondary = ${c.secondary}, updated_at = now()
       WHERE league_id = ${leagueId} AND abbreviation = ${c.abbreviation}
         AND (color_primary IS DISTINCT FROM ${c.primary} OR color_secondary IS DISTINCT FROM ${c.secondary})
       RETURNING id`;
    updated += r.length;
  }
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
