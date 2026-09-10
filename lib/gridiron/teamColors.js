// lib/gridiron/teamColors.js - NFL team colors from nflverse
// (teams_colors_logos.csv, CC-BY-4.0), written to teams.color_primary /
// color_secondary. The join is on abbreviation, and two of nflverse's codes
// differ from BDL's (ours): LA -> LAR (nflverse carries both, identical) and
// WAS -> WSH. Retired franchises in the feed (OAK, SD, STL) are skipped.
export const NFLVERSE_ABBR_MAP = { LA: 'LAR', WAS: 'WSH' };
export const NFLVERSE_RETIRED = new Set(['OAK', 'SD', 'STL']);

const hex = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v ?? '').trim()) ? `#${String(v).trim().replace('#', '').toUpperCase()}` : null);

/** Pure: feed rows -> [{ abbreviation, primary, secondary }], one per current team. */
export function nflColorRows(rows) {
  const out = new Map();
  for (const r of rows) {
    const raw = String(r.team_abbr ?? '').trim();
    if (!raw || NFLVERSE_RETIRED.has(raw)) continue;
    const abbreviation = NFLVERSE_ABBR_MAP[raw] ?? raw;
    const primary = hex(r.team_color); const secondary = hex(r.team_color2);
    if (!primary || !secondary) continue;
    const prev = out.get(abbreviation);
    if (prev && (prev.primary !== primary || prev.secondary !== secondary)) throw new Error(`nflverse disagrees with itself on ${abbreviation}`);
    out.set(abbreviation, { abbreviation, primary, secondary });
  }
  return [...out.values()].sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));
}

/** Write the colors onto the league's teams by abbreviation. Returns what matched. */
export async function syncNflColors(sql, leagueId, rows) {
  const colors = nflColorRows(rows);
  let updated = 0; const unmatched = [];
  for (const c of colors) {
    const r = await sql`
      UPDATE teams SET color_primary = ${c.primary}, color_secondary = ${c.secondary}, updated_at = now()
       WHERE league_id = ${leagueId} AND abbreviation = ${c.abbreviation}
         AND (color_primary IS DISTINCT FROM ${c.primary} OR color_secondary IS DISTINCT FROM ${c.secondary})
       RETURNING id`;
    if (r.length) updated += r.length;
  }
  const have = await sql`SELECT abbreviation FROM teams WHERE league_id = ${leagueId}`;
  const fed = new Set(colors.map((c) => c.abbreviation));
  for (const t of have) if (!fed.has(t.abbreviation)) unmatched.push(t.abbreviation);
  return { fed: colors.length, updated, unmatched };
}
