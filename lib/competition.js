// lib/competition.js: competition resolver for namespaced URLs.
//
// Sportsvyn structural pages (bracket, rankings) live under a dated
// per-competition URL segment, e.g. /world-cup-2026/bracket. This
// module maps a URL segment to the corresponding leagues row and
// parses that row's declared surfaces from leagues.metadata.
//
// Mapping model (so the resolver never trusts an env-derived id, only
// slugs and metadata):
//
//   URL segment          leagues.metadata.url_slug    leagues.slug
//   ----------------     -------------------------    -----------------
//   world-cup-2026       'world-cup-2026'             'fifa-wc-2026'
//
//   Evergreen alias      leagues.metadata.family
//   ----------------     -------------------------
//   world-cup            'world-cup'   (current edition picked by
//                                       is_current_edition=true, falling
//                                       back to MAX(season_year))
//
// Why two slugs: the leagues table predates this routing scheme and
// every existing reader (lib/bracket.js, lib/rankings.js, lib/scheduleData.js,
// etc.) joins by leagues.slug='fifa-wc-2026'. Renaming that slug would
// touch a dozen unrelated files. Storing the URL slug in metadata keeps
// the routing layer decoupled from the data-layer key.
//
// Surfaces:
//   leagues.metadata.bracket   : boolean   (presence + true == enabled)
//   leagues.metadata.rankings  : string[]  (list slugs the comp declares,
//                                           e.g. ['power','players'])
//
// All reads are cached per request via React.cache so callers can ask
// the resolver multiple times in one render pass and the DB is hit
// exactly once.

import { cache } from 'react';
import { sql } from './db.js';

// ---------------------------------------------------------------------------
// Shape returned by the resolvers. Documented as a JSDoc typedef so callers
// (route pages, the proxy redirect path in Phase 3) have a single reference.
// ---------------------------------------------------------------------------
/**
 * @typedef {Object} ResolvedCompetition
 * @property {number}    id                 leagues.id
 * @property {string}    slug               leagues.slug (e.g. 'fifa-wc-2026')
 * @property {string}    name               leagues.name (e.g. '2026 FIFA World Cup')
 * @property {string|null} shortName        leagues.short_name (e.g. 'World Cup')
 * @property {string}    sport              leagues.sport
 * @property {string|null} seasonType       leagues.season_type
 * @property {number|null} seasonYear       leagues.season_year
 * @property {string}    urlSlug            metadata.url_slug, the URL segment
 * @property {string|null} family           metadata.family, the evergreen-alias family
 * @property {Surfaces}  surfaces           parsed surface declarations
 */

/**
 * @typedef {Object} Surfaces
 * @property {boolean}   bracket            true when this comp has /bracket
 * @property {string[]}  rankings           list slugs (e.g. ['power','players'])
 */

// ---------------------------------------------------------------------------
// parseSurfaces(metadata)
//
// Pure function. Reads the surface declarations off a leagues.metadata
// jsonb (already deserialized by neon to a JS object). Defensive against
// missing or malformed entries so a half-configured row degrades to "no
// surfaces" rather than throwing.
// ---------------------------------------------------------------------------
function parseSurfaces(metadata) {
  const m = (metadata && typeof metadata === 'object') ? metadata : {};
  const bracket = m.bracket === true;
  const rankings = Array.isArray(m.rankings)
    ? m.rankings.filter((s) => typeof s === 'string' && s.length > 0)
    : [];
  return { bracket, rankings };
}

// ---------------------------------------------------------------------------
// shapeRow(row)
//
// Pure. Maps a raw SELECT row to the ResolvedCompetition shape. Returns
// null when the row is missing the routing identifier (url_slug): a
// leagues row without url_slug is invisible to the namespaced URL scheme
// by design (legacy leagues that haven't opted in).
// ---------------------------------------------------------------------------
function shapeRow(row) {
  if (!row) return null;
  const md = row.metadata ?? {};
  const urlSlug = typeof md.url_slug === 'string' && md.url_slug.length > 0
    ? md.url_slug
    : null;
  if (!urlSlug) return null;
  return {
    id:         row.id,
    slug:       row.slug,
    name:       row.name,
    shortName:  row.short_name ?? null,
    sport:      row.sport,
    seasonType: row.season_type ?? null,
    seasonYear: row.season_year ?? null,
    urlSlug,
    family:     typeof md.family === 'string' && md.family.length > 0 ? md.family : null,
    surfaces:   parseSurfaces(md),
  };
}

// ---------------------------------------------------------------------------
// resolveCompetitionBySegment(segment)
//
// Maps a URL segment (e.g. 'world-cup-2026') to the corresponding
// leagues row + parsed surfaces. Returns null when no row carries that
// url_slug in its metadata. Wrapped in React.cache so repeated calls
// within the same request render share a single DB round trip.
//
// Use this from route pages under app/[competition]/... to resolve the
// competition before doing any data work, and notFound() when null.
// ---------------------------------------------------------------------------
export const resolveCompetitionBySegment = cache(async (segment) => {
  if (typeof segment !== 'string' || segment.length === 0) return null;
  const rows = await sql`
    SELECT id, slug, name, short_name, sport, season_type, season_year, metadata
      FROM leagues
     WHERE metadata->>'url_slug' = ${segment}
     LIMIT 1
  `;
  return shapeRow(rows[0]);
});

// ---------------------------------------------------------------------------
// resolveCurrentEditionForFamily(family)
//
// Maps an evergreen-alias family (e.g. 'world-cup') to the CURRENT
// competition in that family. Resolution order:
//   1. metadata.family = $family AND metadata.is_current_edition = true
//      (explicit pin: wins if set)
//   2. metadata.family = $family ORDER BY season_year DESC LIMIT 1
//      (implicit pin: the most recent edition is current)
//
// Returns null when no row matches. This is the function the proxy will
// call in Phase 3 to map /world-cup/bracket -> /world-cup-2026/bracket.
// Cached per request via React.cache.
// ---------------------------------------------------------------------------
export const resolveCurrentEditionForFamily = cache(async (family) => {
  if (typeof family !== 'string' || family.length === 0) return null;
  // Explicit pin first.
  const pinned = await sql`
    SELECT id, slug, name, short_name, sport, season_type, season_year, metadata
      FROM leagues
     WHERE metadata->>'family' = ${family}
       AND metadata->>'is_current_edition' = 'true'
     LIMIT 1
  `;
  if (pinned[0]) return shapeRow(pinned[0]);
  // Implicit pin: most recent season_year for the family.
  const recent = await sql`
    SELECT id, slug, name, short_name, sport, season_type, season_year, metadata
      FROM leagues
     WHERE metadata->>'family' = ${family}
     ORDER BY season_year DESC NULLS LAST, id DESC
     LIMIT 1
  `;
  return shapeRow(recent[0]);
});

// ---------------------------------------------------------------------------
// requireBracketSurface(comp), requireRankingsListSurface(comp, listSlug)
//
// Surface-gate helpers for route pages. Pass them the ResolvedCompetition
// from resolveCompetitionBySegment and they return true when the surface
// is declared, false otherwise. Pages should notFound() on false so a
// /nfl/bracket request (before NFL declares bracket=true) renders the
// 404 page, not a half-broken bracket against the wrong data.
// ---------------------------------------------------------------------------
export function requireBracketSurface(comp) {
  return !!comp && comp.surfaces.bracket === true;
}

export function requireRankingsListSurface(comp, listSlug) {
  if (!comp) return false;
  return comp.surfaces.rankings.includes(listSlug);
}

// ---------------------------------------------------------------------------
// RANKING_LIST_META_BY_URL_LEAF
//
// Map from a URL leaf segment under /<comp>/rankings/<leaf> to the
// canonical ranking_lists.slug it represents, plus display labels for
// the hub. The URL leaf is intentionally short ('power', 'players') so
// the canonical URL reads well; the ranking_lists table uses the
// longer slugs ('team-power', 'player-power') because the same
// vocabulary is meant to scale across leagues.
//
// Used by:
//   - the /<comp>/rankings hub to render its list of leaves with labels
//   - each /<comp>/rankings/<leaf>/page.js to look up its list slug
//   - the proxy in Phase 3 if it needs to validate evergreen-alias paths
// ---------------------------------------------------------------------------
export const RANKING_LIST_META_BY_URL_LEAF = {
  power: {
    listSlug: 'team-power',
    label:    'Team Power Rankings',
    tagline:  'Forty-eight nations, ranked.',
  },
  players: {
    listSlug: 'player-power',
    label:    'Tournament MVP',
    tagline:  'Who is winning the Player-of-the-Tournament conversation right now.',
  },
};

export function getRankingListMetaForUrlLeaf(leaf) {
  if (typeof leaf !== 'string') return null;
  return RANKING_LIST_META_BY_URL_LEAF[leaf] ?? null;
}
