// lib/gridiron/nameMatch.js - resolve sim_player_pool identities to nfl_players.
//
// Exact, conservative matching only: a pool identity (distinct name+position,
// spanning several snapshot rows) is auto-written to matched_player_id ONLY when
// it maps to exactly one nfl_players row. Suffix players (Jr/Sr/II/III/IV) are
// handled by de-suffixing BOTH sides in normalizeName, so "Michael Pittman Jr."
// (pool) meets "Michael Pittman" (BDL) - unless that collapse is ambiguous, which
// is reported, never guessed. Team defenses (pool position DEF) match by team
// ABBREVIATION -> the synthetic per-team DST identity, since DST display names
// ("LA Chargers Defense") do not track BDL location strings.
//
// Anything ambiguous or unmatched goes into the returned report, NOT the DB.

// Diacritic-stripped, lowercased, de-punctuated, de-suffixed. Used identically
// when writing nfl_players.normalized_name and when matching pool names.
export function normalizeName(raw) {
  return String(raw ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/[.'’]/g, '')      // drop periods/apostrophes: D.J.->dj, D'Andre->dandre
    .replace(/[^a-z0-9]+/g, ' ')     // any other punctuation/hyphen -> space
    .trim().replace(/\s+/g, ' ')
    .replace(/\s+(jr|sr|ii|iii|iv)$/,'') // strip ONE trailing generational suffix
    .trim();
}

// FFC/BDL team-abbreviation deltas (pool uses FFC codes; teams table uses BDL).
// Only Washington differs among the pool's 18 defenses (FFC 'WAS' vs BDL 'WSH');
// JAC/JAX aliased defensively in case a future snapshot uses the older code.
const TEAM_ABBR_ALIAS = { WAS: 'WSH', JAC: 'JAX' };

// FFC vocab (QB/RB/WR/TE/PK/DEF) from a raw BDL position abbreviation.
export function ffcPosition(bdlAbbr) {
  const p = String(bdlAbbr ?? '').toUpperCase();
  if (p === 'K' || p === 'PK') return 'PK';
  if (p === 'FB') return 'RB';
  if (['QB', 'RB', 'WR', 'TE'].includes(p)) return p;
  return p; // defensive/other positions pass through (valid stat producers)
}

// Resolves all 218 pool identities. Writes matched_player_id across every snapshot
// row of a resolved identity. Returns { matched, unmatched, ambiguous, counts }.
export async function matchPoolIdentities(sql, { log = () => {} } = {}) {
  // Index real nfl_players by (normalized_name, position) -> [ids]
  const players = await sql`
    SELECT id, normalized_name, position FROM nfl_players WHERE is_team_defense = false`;
  const byKey = new Map();
  for (const p of players) {
    const k = `${p.normalized_name}|${p.position}`;
    (byKey.get(k) ?? byKey.set(k, []).get(k)).push(p.id);
  }
  // Team-defense identities by team abbreviation
  const dst = await sql`
    SELECT np.id, t.abbreviation FROM nfl_players np
    JOIN teams t ON np.team_id = t.id WHERE np.is_team_defense = true`;
  const dstByAbbr = new Map(dst.map((d) => [d.abbreviation, d.id]));

  // Distinct pool identities
  const identities = await sql`
    SELECT DISTINCT name, position, team FROM sim_player_pool ORDER BY position, name`;

  const matched = [], unmatched = [], ambiguous = [];
  for (const idn of identities) {
    let targetId = null;
    if (idn.position === 'DEF') {
      const abbr = TEAM_ABBR_ALIAS[idn.team] ?? idn.team;
      targetId = dstByAbbr.get(abbr) ?? null;
      if (!targetId) { unmatched.push({ ...idn, reason: `no DST identity for team '${idn.team}'` }); continue; }
    } else {
      const key = `${normalizeName(idn.name)}|${idn.position}`;
      const hits = byKey.get(key) ?? [];
      if (hits.length === 0) { unmatched.push({ ...idn, reason: 'no normalized name+position match' }); continue; }
      if (hits.length > 1) { ambiguous.push({ ...idn, reason: `${hits.length} nfl_players share this normalized name+position`, candidateIds: hits }); continue; }
      targetId = hits[0];
    }
    // write across every snapshot row for this identity
    await sql`UPDATE sim_player_pool SET matched_player_id = ${targetId}
              WHERE name = ${idn.name} AND position = ${idn.position}`;
    matched.push({ ...idn, matched_player_id: targetId });
  }

  const rowsWritten = await sql`SELECT count(*)::int n FROM sim_player_pool WHERE matched_player_id IS NOT NULL`;
  const counts = {
    identitiesTotal: identities.length,
    matched: matched.length,
    unmatched: unmatched.length,
    ambiguous: ambiguous.length,
    poolRowsWritten: rowsWritten[0].n,
  };
  log(`match: ${counts.matched}/${counts.identitiesTotal} identities (${counts.unmatched} unmatched, ${counts.ambiguous} ambiguous); ${counts.poolRowsWritten} pool rows written`);
  return { matched, unmatched, ambiguous, counts };
}
