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
// Exported: lib/fantasy/dstName.js names a defense from the same table, so the
// club a DST's stats join to and the club its name says are one club.
export const TEAM_ABBR_ALIAS = { WAS: 'WSH', JAC: 'JAX' };

// FFC vocab (QB/RB/WR/TE/PK/DEF) from a raw BDL position abbreviation.
export function ffcPosition(bdlAbbr) {
  const p = String(bdlAbbr ?? '').toUpperCase();
  if (p === 'K' || p === 'PK') return 'PK';
  if (p === 'FB') return 'RB';
  if (['QB', 'RB', 'WR', 'TE'].includes(p)) return p;
  return p; // defensive/other positions pass through (valid stat producers)
}

// A DEFENSE ROW'S NAME COMES IN TWO DIALECTS (ruling 2 Sep 2026), and the
// matcher accepts both, case-insensitively, for DEF rows only:
//   derived   "<Club> D/ST"            the display grammar (lib/fantasy/dstName.js)
//   provider  "Seattle Defense" (FFC), "Team" / "Team Offense" / "Team Defense" /
//             "Defense/Special Teams" (the Fantrax feed's team-row field)
// The TEAM code still decides the target; the name is checked, not trusted: a
// derived name must name the club the row's team code says (a "Denver Broncos
// D/ST" row coded HOU is a contradiction, not a match), and a name in neither
// dialect is a miss. Every DEF miss is reported with its reason and logged -
// a defense that silently fell out of the stats join is how 2 Sep happened.
const DST_DERIVED_RE = /^(.+?)\s+d\/st$/i;
const DST_PROVIDER_STRINGS = new Set(['team', 'team offense', 'team defense', 'defense/special teams', 'd/st', 'dst']);
const DST_FFC_RE = /^(.+?)\s+defense$/i;
export function dstNameDialect(name) {
  const n = String(name ?? '').trim().toLowerCase();
  if (!n) return null;
  if (DST_DERIVED_RE.test(n)) return 'derived';
  if (DST_PROVIDER_STRINGS.has(n) || DST_FFC_RE.test(n)) return 'provider';
  return null;
}
export function isDefPosition(position) {
  const p = String(position ?? '').toUpperCase();
  return p === 'DEF' || p === 'DST';
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
    SELECT np.id, t.abbreviation, t.name AS club FROM nfl_players np
    JOIN teams t ON np.team_id = t.id WHERE np.is_team_defense = true`;
  const dstByAbbr = new Map(dst.map((d) => [d.abbreviation, { id: d.id, club: String(d.club ?? '') }]));

  // Distinct pool identities
  const identities = await sql`
    SELECT DISTINCT name, position, team FROM sim_player_pool ORDER BY position, name`;

  const matched = [], unmatched = [], ambiguous = [];
  for (const idn of identities) {
    let targetId = null;
    if (isDefPosition(idn.position)) {
      const miss = (reason) => { unmatched.push({ ...idn, reason }); log(`match: DEF miss ${idn.team ?? '?'} "${idn.name}": ${reason}`); };
      const dialect = dstNameDialect(idn.name);
      if (!dialect) { miss(`DST name "${idn.name}" is neither "<Club> D/ST" nor a provider string`); continue; }
      const code = String(idn.team ?? '').toUpperCase();
      const abbr = TEAM_ABBR_ALIAS[code] ?? code;
      const hit = dstByAbbr.get(abbr) ?? null;
      if (!hit) { miss(`no DST identity for team '${idn.team}'`); continue; }
      if (dialect === 'derived') {
        const named = String(idn.name).trim().match(DST_DERIVED_RE)[1].toLowerCase();
        if (named !== hit.club.toLowerCase()) { miss(`name says "${idn.name}", team code says ${hit.club}`); continue; }
      }
      targetId = hit.id;
    } else {
      const key = `${normalizeName(idn.name)}|${idn.position}`;
      const hits = byKey.get(key) ?? [];
      if (hits.length === 0) { unmatched.push({ ...idn, reason: 'no normalized name+position match' }); continue; }
      if (hits.length > 1) { ambiguous.push({ ...idn, reason: `${hits.length} nfl_players share this normalized name+position`, candidateIds: hits }); continue; }
      targetId = hits[0];
    }
    // Write across every snapshot row for THIS identity - the (name, position,
    // team) triple the SELECT DISTINCT above defined, not a prefix of it.
    //
    // 2 SEP 2026: this keyed on name + position only. The Fantrax feed names
    // its 32 defenses "Team" (x15), "Defense/Special Teams" (x7), "Team
    // Offense" (x6) and "Team Defense" (x4), so the loop resolved HOU's row
    // correctly and then wrote the Eagles' DST id (13550) onto every "Team
    // Offense" row, PHI's included, and the last team in each name group won
    // for the rest - 32 defenses landed on 4 nfl_players. Every DST on the
    // Fantrax pool showed another club's sacks. The team is part of the key.
    await sql`UPDATE sim_player_pool SET matched_player_id = ${targetId}
              WHERE name = ${idn.name} AND position = ${idn.position}
                AND team IS NOT DISTINCT FROM ${idn.team}`;
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
