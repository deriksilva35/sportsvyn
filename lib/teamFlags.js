// lib/teamFlags.js — DB-aware team abbreviation / flag resolution.
//
// Single source of truth for: cross-league abbreviation lookup +
// /teams API acquisition + collision disambiguation. Called by
// lib/syncFixture's upsertTeam (proactive at sync time) AND
// scripts/backfill-flags.mjs (retroactive cleanup of legacy NULL rows).
// The two call sites share this helper so they can't drift on
// resolution policy.
//
// Resolution order (Path B1):
//   1. ownAbbreviation if the caller has it (the /teams import path
//      reads team.code directly into apiTeam — pass it through here)
//   2. cross-league SIBLING lookup: any teams row with the same
//      api_sports id whose abbreviation is non-null. Catches the
//      WC-team-then-friendly case (WC import populates code via
//      /teams; friendly cross-looks-up from there).
//   3. /teams?id=<apiSportsId> fetch via apiSports.teamById — the
//      live-acquisition path. Bounded by the per-process cache so a
//      single tick syncing five fixtures with the same team makes one
//      /teams call, not five.
//   4. null. We never invent.
//
// Canonicalization (API_SPORTS_ID_OVERRIDES) runs ABOVE whatever
// resolution path produced rawAbbr. Iran/Iraq's IRA→IRN/IRQ override
// applies whether the code came from /teams, from a sibling, or from
// the caller. lib/flags.js stays pure (no DB, no override layer); this
// file is the layer above it.
//
// Collision detection: when (and only when) we ACQUIRE a code via
// /teams (path 3), we check whether the canonical form is already
// stored on a DIFFERENT api_sports id in the DB. If so, that's a fresh
// IRA-pattern collision and we log loudly — the upsert still proceeds
// (we don't refuse to write), but a fresh collision must NOT go silent.

import { sql } from './db.js';
import { apiSports } from './apiSports.js';
import { flagcdnUrl } from './flags.js';

// API-Sports stores "IRA" for BOTH Iran (id=22) and Iraq (id=1567) — a
// real data-quality collision confirmed on prod. lib/flags.js
// INTENTIONALLY omits "IRA" from its CODE_TO_ISO map (safe-degrade to
// empty flag rather than guess wrong). This override layer keys on
// api_sports id, which IS distinct, and canonicalizes to a FIFA code
// (IRN / IRQ) that flagcdnUrl resolves.
//
// Add entries as new collisions surface. The /teams-acquisition
// collision-detect emits a loud log when a new one shows up, so this
// map gets extended deliberately, not silently.
// API_SPORTS_ID_OVERRIDES — two roles:
//   (1) Disambiguate API-Sports code collisions (multiple nations
//       sending the same 3-letter code). The static map in lib/flags.js
//       picks one "default" nation per colliding code; this map
//       overrides the OTHERS by api_sports_id.
//   (2) Force a canonical abbreviation for teams API-Sports sends as
//       code:null (small nations, youth-only configurations, etc.).
//       Without this, code-null teams resolve to NULL abbreviation +
//       empty flag rectangle.
//
// Add entries only with verified evidence (the team's confirmed
// api_sports id + the team's correct FIFA code + lib/flags.js's
// corresponding ISO entry). The B1 collision detector's loud log is
// what surfaces new entries that need adding.
const API_SPORTS_ID_OVERRIDES = {
  // IRA collision (Iran + Iraq) — verified prod data 2026-06-04
  22:   'IRN',  // Iran  — API-Sports sends 'IRA'
  1567: 'IRQ',  // Iraq  — API-Sports sends 'IRA'

  // MAL collision (4 nations) — verified 2026-06-05 via /teams?country=*
  // Static default in lib/flags.js is Mali (MAL → 'ml'). Override the rest.
  1112: 'MLT',  // Malta    — API-Sports sends 'MAL'
  1538: 'MAS',  // Malaysia — API-Sports sends 'MAL'
  1495: 'MWI',  // Malawi   — API-Sports sends 'MAL'

  // CHI collision (Chile + China) — Chile is the static default.
  1566: 'CHN',  // China — API-Sports sends 'CHI'

  // GUI collision (Guinea + Guinea-Bissau) — Guinea is the static default.
  1513: 'GNB',  // Guinea-Bissau — API-Sports sends 'GUI'

  // NIG collision (Nigeria + Niger) — Nigeria is the static default.
  1505: 'NER',  // Niger — API-Sports sends 'NIG'

  // CON / CGO Congo split. Both Brazzaville (1517) and Congo DR (1508)
  // have ambiguous-looking codes; lib/flags.js has CON → 'cg' (Brazzaville)
  // and CGO → 'cd' (Congo DR). Brazzaville resolves correctly without an
  // override (API-Sports sends CON). Congo DR needs the override because
  // (a) legacy dev/prod data may store CON (mis-synced before this fix),
  // and (b) API-Sports's actual current code for Congo DR is CGO — both
  // paths must canonicalize to CGO so the right flag renders.
  1508: 'CGO',  // Congo DR — API-Sports sends 'CGO'; existing dev/prod rows may store 'CON'

  // Code-null nations. API-Sports sends code:null for these so B1's
  // /teams path acquires null; this map forces a canonical abbreviation
  // that lib/flags.js resolves to the correct flag.
  1093: 'GIB',  // Gibraltar
  1102: 'LUX',  // Luxembourg
  5158: 'BER',  // Bermuda
  5160: 'FJI',  // Fiji
  5170: 'VAN',  // Vanuatu
  8119: 'GUM',  // Guam
  8169: 'CYM',  // Cayman Islands
  771:  'NIR',  // Northern Ireland (verified audit: API-Sports sends code:null;
                //                   static map has NIR → 'gb-nir')
};

// Per-process cache for /teams?id=X results. Keyed by String(apiSportsId);
// value is the team's code (or null on miss/failure). team.code is stable
// data, so a cache hit across an entire process run is safe. New process
// = fresh cache; codes get re-fetched on demand.
const _teamByIdCache = new Map();

export function canonicalAbbreviation(apiSportsId, rawAbbreviation) {
  if (apiSportsId != null && API_SPORTS_ID_OVERRIDES[apiSportsId]) {
    return API_SPORTS_ID_OVERRIDES[apiSportsId];
  }
  return rawAbbreviation ?? null;
}

// Loud-log collision detector. Called only when we acquire a code via
// the /teams API (the fresh-data path). Checks whether the canonical
// abbreviation we're about to rely on is already stored on a DIFFERENT
// api_sports id — the Iran/Iraq pattern, but for codes we haven't
// catalogued yet. Logs the team + the conflicting team(s) so the
// override map can be extended on the next deploy.
//
// Exported for direct test invocation (verification of the loud-log
// behavior without having to plant fake data through the full
// resolver flow).
export async function detectAbbreviationCollision(apiSportsId, canonical) {
  if (!canonical) return false;
  const conflicts = await sql`
    SELECT external_ids->>'api_sports' AS api_id, name
      FROM teams
     WHERE abbreviation = ${canonical}
       AND external_ids->>'api_sports' <> ${String(apiSportsId)}
     LIMIT 5
  `;
  if (conflicts.length === 0) return false;
  console.error(
    `⚠ COLLISION SUSPECTED — needs override map entry in lib/teamFlags.js\n` +
    `  acquiring abbreviation "${canonical}" for api_sports_id=${apiSportsId}\n` +
    `  but it is already stored on api_sports_id=[${conflicts.map(c => c.api_id).join(', ')}]\n` +
    `  conflicting team rows: ${conflicts.map(c => c.name).join(', ')}`
  );
  return true;
}

// Fetch the team's `code` from /teams?id=X. Cached per-process.
// Never throws — a /teams failure (network, rate limit, etc.) must NOT
// abort the surrounding sync. On failure we cache null so we don't
// retry-storm in the same process; the next process tries again.
async function acquireCodeViaTeamsApi(apiSportsId) {
  const key = String(apiSportsId);
  if (_teamByIdCache.has(key)) return _teamByIdCache.get(key);
  try {
    const response = await apiSports.teamById(apiSportsId);
    const code = response?.[0]?.team?.code ?? null;
    _teamByIdCache.set(key, code);
    return code;
  } catch (err) {
    console.error(`acquireCodeViaTeamsApi(${apiSportsId}) failed:`, err?.message ?? err);
    _teamByIdCache.set(key, null);
    return null;
  }
}

// Test-only cache reset. Lets dev verification call resolve twice for
// the same team and exercise the /teams path both times. Production
// callers should not use this.
export function _resetTeamByIdCacheForTests() {
  _teamByIdCache.clear();
}

// End-to-end resolver. Returns { abbreviation, flag_svg_path } —
// either nullable. Used at upsertTeam-time AND by the backfill so a
// future change to resolution policy lands in both places.
export async function resolveTeamFlagAssets(
  apiSportsId,
  { ownAbbreviation = null, excludeTeamId = null } = {},
) {
  let rawAbbr = ownAbbreviation;
  let acquiredViaTeamsApi = false;

  // Path 2: cross-league sibling lookup.
  if (!rawAbbr) {
    const rows = excludeTeamId
      ? await sql`
          SELECT abbreviation FROM teams
           WHERE external_ids->>'api_sports' = ${String(apiSportsId)}
             AND abbreviation IS NOT NULL
             AND id <> ${excludeTeamId}
           LIMIT 1
        `
      : await sql`
          SELECT abbreviation FROM teams
           WHERE external_ids->>'api_sports' = ${String(apiSportsId)}
             AND abbreviation IS NOT NULL
           LIMIT 1
        `;
    rawAbbr = rows[0]?.abbreviation ?? null;
  }

  // Path 3 (B1): /teams API fallback. Only fires when both ownAbbreviation
  // and the cross-league lookup yielded nothing.
  if (!rawAbbr) {
    rawAbbr = await acquireCodeViaTeamsApi(apiSportsId);
    acquiredViaTeamsApi = true;
  }

  const canonical = canonicalAbbreviation(apiSportsId, rawAbbr);

  // Collision detect runs ONLY on the /teams-acquisition path. A code
  // we've already catalogued (via ownAbbreviation or a sibling) has
  // already been examined — re-checking on every resolve would be
  // noisy. A fresh code from /teams is exactly where a new IRA-pattern
  // collision would enter.
  if (acquiredViaTeamsApi && canonical) {
    await detectAbbreviationCollision(apiSportsId, canonical);
  }

  return {
    abbreviation:  canonical,
    flag_svg_path: canonical ? flagcdnUrl(canonical) : null,
  };
}
