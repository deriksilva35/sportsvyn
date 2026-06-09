// scripts/seed-sites-layer.js
//
// DEV-ONLY seed for the Sites Layer raw ranks (3 sources: FIFA + ESPN + The Athletic).
//
// New shape per entry: { team, fifa_rank_global, espn_rank, athletic_rank }
//   · fifa_rank_global  — FIFA's GLOBAL rank (1..85+) across all FIFA members.
//                         The runner re-ranks the 48 WC teams to WITHIN-FIELD
//                         1..48 ASC by global rank before normalizing.
//   · espn_rank         — ESPN's within-field rank (1..48). Used directly.
//   · athletic_rank     — The Athletic's within-field rank (1..48). Used directly.
//
// Job: resolve each `team` to a teams.id row on DEV, report any team that
// doesn't match, and project the within-field FIFA re-rank + per-source
// scores so the seed can be eyeballed before any real run. NO writes.
//
// The CALLER (lib/rankings/editionRunner.js via the sitesSeed argument)
// uses the resolved seed to populate ranking_entries.fifa_*/espn_*/
// athletic_*/sites_composite columns when the edition runner writes.
//
// host-guard: refuses to run against ep-winter-dawn (PROD).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadEnvLocal(p) {
  let text;
  try { text = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const k = s.slice(0, eq).trim();
    let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvLocal(path.resolve(__dirname, '..', '.env.local'));

// =============================================================================
// LOCKED 48-team WC 2026 sites seed (real ranks supplied by the user).
//
// `team` is matched against (a) teams.name (case-insensitive exact),
// then (b) teams.abbreviation. The WC league row is preferred over
// duplicates across leagues. Name variants the resolver needs to
// handle: Ivory Coast / Côte d'Ivoire, Congo DR / DR Congo,
// Cape Verde / Cabo Verde, South Korea / Korea Republic, Czech Republic
// / Czechia, Türkiye / Turkey.
// =============================================================================
export const WC_2026_SITES_SEED = [
  { team: 'Argentina',            fifa_rank_global:  1, espn_rank:  7, athletic_rank:  3 },
  { team: 'Spain',                fifa_rank_global:  2, espn_rank:  2, athletic_rank:  1 },
  { team: 'France',               fifa_rank_global:  3, espn_rank:  1, athletic_rank:  2 },
  { team: 'England',              fifa_rank_global:  4, espn_rank:  3, athletic_rank:  5 },
  { team: 'Portugal',             fifa_rank_global:  5, espn_rank:  4, athletic_rank:  8 },
  { team: 'Brazil',               fifa_rank_global:  6, espn_rank:  6, athletic_rank:  4 },
  { team: 'Morocco',              fifa_rank_global:  7, espn_rank: 14, athletic_rank: 12 },
  { team: 'Netherlands',          fifa_rank_global:  8, espn_rank:  8, athletic_rank:  7 },
  { team: 'Belgium',              fifa_rank_global:  9, espn_rank: 12, athletic_rank: 16 },
  { team: 'Germany',              fifa_rank_global: 10, espn_rank:  5, athletic_rank:  6 },
  { team: 'Croatia',              fifa_rank_global: 11, espn_rank: 16, athletic_rank: 10 },
  { team: 'Colombia',             fifa_rank_global: 13, espn_rank: 18, athletic_rank:  9 },
  { team: 'Mexico',               fifa_rank_global: 14, espn_rank: 24, athletic_rank: 19 },
  { team: 'Senegal',              fifa_rank_global: 15, espn_rank: 11, athletic_rank: 13 },
  { team: 'Uruguay',              fifa_rank_global: 16, espn_rank: 13, athletic_rank: 11 },
  { team: 'USA',                  fifa_rank_global: 17, espn_rank: 22, athletic_rank: 22 },
  { team: 'Japan',                fifa_rank_global: 18, espn_rank: 21, athletic_rank: 23 },
  { team: 'Switzerland',          fifa_rank_global: 19, espn_rank: 19, athletic_rank: 21 },
  { team: 'Iran',                 fifa_rank_global: 20, espn_rank: 35, athletic_rank: 31 },
  { team: 'Türkiye',              fifa_rank_global: 22, espn_rank: 10, athletic_rank: 24 },
  { team: 'Ecuador',              fifa_rank_global: 23, espn_rank: 15, athletic_rank: 17 },
  { team: 'Austria',              fifa_rank_global: 24, espn_rank: 23, athletic_rank: 27 },
  { team: 'South Korea',          fifa_rank_global: 25, espn_rank: 30, athletic_rank: 15 },
  { team: 'Australia',            fifa_rank_global: 27, espn_rank: 32, athletic_rank: 25 },
  { team: 'Algeria',              fifa_rank_global: 28, espn_rank: 26, athletic_rank: 26 },
  { team: 'Egypt',                fifa_rank_global: 29, espn_rank: 31, athletic_rank: 14 },
  { team: 'Canada',               fifa_rank_global: 30, espn_rank: 25, athletic_rank: 29 },
  { team: 'Norway',               fifa_rank_global: 31, espn_rank:  9, athletic_rank: 18 },
  { team: 'Ivory Coast',          fifa_rank_global: 33, espn_rank: 17, athletic_rank: 20 },
  { team: 'Panama',               fifa_rank_global: 34, espn_rank: 38, athletic_rank: 33 },
  { team: 'Sweden',               fifa_rank_global: 38, espn_rank: 20, athletic_rank: 32 },
  { team: 'Czech Republic',       fifa_rank_global: 39, espn_rank: 29, athletic_rank: 39 },
  { team: 'Paraguay',             fifa_rank_global: 40, espn_rank: 27, athletic_rank: 30 },
  { team: 'Scotland',             fifa_rank_global: 42, espn_rank: 28, athletic_rank: 34 },
  { team: 'Congo DR',             fifa_rank_global: 45, espn_rank: 33, athletic_rank: 44 },
  { team: 'Tunisia',              fifa_rank_global: 46, espn_rank: 39, athletic_rank: 36 },
  { team: 'Uzbekistan',           fifa_rank_global: 51, espn_rank: 34, athletic_rank: 41 },
  { team: 'Iraq',                 fifa_rank_global: 56, espn_rank: 42, athletic_rank: 47 },
  { team: 'Qatar',                fifa_rank_global: 57, espn_rank: 48, athletic_rank: 38 },
  { team: 'South Africa',         fifa_rank_global: 60, espn_rank: 46, athletic_rank: 37 },
  { team: 'Saudi Arabia',         fifa_rank_global: 61, espn_rank: 44, athletic_rank: 35 },
  { team: 'Jordan',               fifa_rank_global: 63, espn_rank: 40, athletic_rank: 42 },
  { team: 'Bosnia & Herzegovina', fifa_rank_global: 64, espn_rank: 37, athletic_rank: 43 },
  { team: 'Cape Verde',           fifa_rank_global: 67, espn_rank: 43, athletic_rank: 46 },
  { team: 'Ghana',                fifa_rank_global: 73, espn_rank: 36, athletic_rank: 28 },
  { team: 'Curaçao',              fifa_rank_global: 82, espn_rank: 47, athletic_rank: 45 },
  { team: 'Haiti',                fifa_rank_global: 83, espn_rank: 45, athletic_rank: 48 },
  { team: 'New Zealand',          fifa_rank_global: 85, espn_rank: 41, athletic_rank: 40 },
];

// =============================================================================
// Name variants we expect the resolver to handle (per Part 3 spec):
//   Ivory Coast       ↔ Côte d'Ivoire
//   Congo DR          ↔ DR Congo
//   Cape Verde        ↔ Cabo Verde / Cape Verde Islands
//   South Korea       ↔ Korea Republic
//   Czech Republic    ↔ Czechia
//   Türkiye           ↔ Turkey
// =============================================================================
const NAME_VARIANTS = {
  'ivory coast': ['ivory coast', "côte d'ivoire", 'cote d’ivoire', 'cote d ivoire'],
  'congo dr': ['congo dr', 'dr congo', 'democratic republic of congo'],
  'cape verde': ['cape verde', 'cabo verde', 'cape verde islands'],
  'south korea': ['south korea', 'korea republic', 'republic of korea'],
  'czech republic': ['czech republic', 'czechia'],
  'türkiye': ['türkiye', 'turkiye', 'turkey'],
};

// =============================================================================
// Team resolver — name → team_id. Prefers the fifa-wc-2026 league row.
// Returns { id, name, abbreviation, league_slug, matched_via } or null.
// =============================================================================
export async function resolveTeam(query, { sql }) {
  // Candidate names: the literal query + any variants under that key.
  const lowered = query.toLowerCase();
  const candidates = NAME_VARIANTS[lowered] ?? [lowered];

  for (const c of candidates) {
    const byName = await sql`
      SELECT t.id, t.name, t.abbreviation, l.slug AS league_slug
        FROM teams t
        LEFT JOIN leagues l ON l.id = t.league_id
       WHERE LOWER(t.name) = ${c}
       ORDER BY CASE WHEN l.slug = 'fifa-wc-2026' THEN 0 ELSE 1 END,
                t.id ASC
       LIMIT 1
    `;
    if (byName.length > 0) return { ...byName[0], matched_via: 'name', match_string: c };
  }

  // Abbreviation fallback.
  const byAbbr = await sql`
    SELECT t.id, t.name, t.abbreviation, l.slug AS league_slug
      FROM teams t
      LEFT JOIN leagues l ON l.id = t.league_id
     WHERE LOWER(t.abbreviation) = ${lowered}
     ORDER BY CASE WHEN l.slug = 'fifa-wc-2026' THEN 0 ELSE 1 END,
              t.id ASC
     LIMIT 1
  `;
  if (byAbbr.length > 0) return { ...byAbbr[0], matched_via: 'abbreviation', match_string: lowered };

  return null;
}

// =============================================================================
// Resolve ALL seed entries to team_ids on the connected DB.
// Returns { resolved: [{ team_id, fifa_rank_global, espn_rank, athletic_rank, _meta }], missing: [{ team }] }.
// =============================================================================
export async function resolveSeedToTeamIds(seed, { sql }) {
  const resolved = [];
  const missing = [];
  for (const e of seed) {
    const match = await resolveTeam(e.team, { sql });
    if (!match) { missing.push(e); continue; }
    resolved.push({
      team_id: match.id,
      fifa_rank_global: e.fifa_rank_global,
      espn_rank: e.espn_rank,
      athletic_rank: e.athletic_rank,
      _meta: { query: e.team, matched_name: match.name, matched_via: match.matched_via, league_slug: match.league_slug },
    });
  }
  return { resolved, missing };
}

// =============================================================================
// CLI when run directly: resolve + project + print.
// =============================================================================
const isCLI = import.meta.url === `file://${process.argv[1]}`;
if (isCLI) {
  const host = new URL(process.env.DATABASE_URL).hostname;
  if (host.includes('winter-dawn')) {
    console.error('REFUSE: seed script targets DEV only; saw PROD host', host);
    process.exit(1);
  }
  console.log('✓ host (DEV):', host);

  const { sql } = await import('../lib/db.js');
  const { normalizeRankToScore, sitesComposite, buildSitesRanksFromSeed } = await import('../lib/rankings/sitesLayer.js');

  const { resolved, missing } = await resolveSeedToTeamIds(WC_2026_SITES_SEED, { sql });
  console.log('\n=== RESOLUTION (' + resolved.length + ' / ' + WC_2026_SITES_SEED.length + ') ===');
  for (const r of resolved) {
    console.log('  ' + r._meta.query.padEnd(24) + ' → team_id=' + String(r.team_id).padEnd(4) + '  name=' + (r._meta.matched_name ?? '?').padEnd(24) + ' via=' + r._meta.matched_via + ' league=' + r._meta.league_slug);
  }
  if (missing.length > 0) {
    console.log('\nUNRESOLVED (' + missing.length + '):');
    for (const m of missing) console.log('  · ' + JSON.stringify(m));
  } else {
    console.log('\n✓ all seed entries resolved');
  }

  // Project FIFA within-field rank + per-source scores.
  const teamRows = await sql`SELECT t.id, t.name FROM teams t JOIN leagues l ON l.id = t.league_id WHERE l.slug = 'fifa-wc-2026' ORDER BY t.name`;
  const sitesMap = buildSitesRanksFromSeed(teamRows, resolved, 48);

  console.log('\n=== WITHIN-FIELD FIFA RE-RANK (sorted by re-rank) ===');
  const rows = [...sitesMap.entries()]
    .map(([id, s]) => ({ id, ...s, name: teamRows.find(t => t.id === id)?.name }))
    .sort((a, b) => (a.fifa_rank ?? 999) - (b.fifa_rank ?? 999));
  console.log('  re#  team                            fifa(g)  espn  ath   fifa_sc  espn_sc  ath_sc  sites_comp');
  for (const r of rows) {
    console.log('  ' + String(r.fifa_rank).padStart(3) + '  ' +
      (r.name ?? '?').padEnd(30) +
      String(r.fifa_rank_global).padStart(6) + '   ' +
      String(r.espn_rank).padStart(4) + '  ' +
      String(r.athletic_rank).padStart(4) + '   ' +
      (r.fifa_score?.toFixed(2) ?? '∅').padStart(6) + '   ' +
      (r.espn_score?.toFixed(2) ?? '∅').padStart(6) + '  ' +
      (r.athletic_score?.toFixed(2) ?? '∅').padStart(6) + '  ' +
      (r.sites_composite?.toFixed(2) ?? '∅').padStart(8));
  }
}
