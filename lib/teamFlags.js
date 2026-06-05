// lib/teamFlags.js — DB-aware team abbreviation / flag resolution.
//
// Single source of truth for: cross-league abbreviation lookup +
// collision disambiguation. Called by lib/syncFixture's upsertTeam
// (proactive at sync time) AND scripts/backfill-flags.mjs (retroactive
// cleanup of legacy NULL rows). The two call sites share this helper so
// they can't drift on collision-handling policy.
//
// lib/flags.js stays pure (no DB, just FIFA-code → flagcdn URL). This
// file is the DB-aware layer on top.

import { sql } from './db.js';
import { flagcdnUrl } from './flags.js';

// API-Sports stores "IRA" for BOTH Iran (id=22) and Iraq (id=1567) — a
// real data-quality collision confirmed on prod. lib/flags.js
// INTENTIONALLY omits "IRA" from its CODE_TO_ISO map (safe-degrade to
// empty flag rather than guess wrong). This override layer keys on
// api_sports id, which IS distinct, and canonicalizes to a FIFA code
// (IRN / IRQ) that flagcdnUrl resolves.
//
// Add entries as new collisions surface. Each entry should be backed by
// verified evidence (the team's confirmed api_sports id + the team's
// canonical FIFA code) — don't add speculatively.
const API_SPORTS_ID_OVERRIDES = {
  22:   'IRN',  // Iran  — raw API-Sports value 'IRA' collides with Iraq
  1567: 'IRQ',  // Iraq  — raw API-Sports value 'IRA' collides with Iran
};

// Canonicalize a raw abbreviation using the team's api_sports id when
// available. For non-collision teams returns the raw value unchanged.
// Returns null when both inputs are null.
export function canonicalAbbreviation(apiSportsId, rawAbbreviation) {
  if (apiSportsId != null && API_SPORTS_ID_OVERRIDES[apiSportsId]) {
    return API_SPORTS_ID_OVERRIDES[apiSportsId];
  }
  return rawAbbreviation ?? null;
}

// End-to-end resolver. Returns { abbreviation, flag_svg_path } —
// either nullable. Used at upsertTeam-time AND by the backfill so a
// future change to collision policy lands in both places.
//
// Inputs:
//   apiSportsId      — the team's external_ids->>'api_sports' id (used
//                       for both cross-league lookup and the override map)
//   ownAbbreviation  — team.code if the caller already has it from a
//                       /teams payload; otherwise null (the /fixtures
//                       payload doesn't carry team.code, so syncFixture
//                       passes null and we cross-look-up)
//   excludeTeamId    — when called from the backfill script, exclude
//                       the row being updated so we don't return its own
//                       (currently-null) abbreviation as the cross answer
//
// We STORE the canonical abbreviation (not the raw API-Sports value)
// so downstream renders (event tags, team chips) show the correct
// FIFA code and the flag column resolves cleanly. The raw 'IRA' is
// not preserved anywhere — by design.
export async function resolveTeamFlagAssets(
  apiSportsId,
  { ownAbbreviation = null, excludeTeamId = null } = {},
) {
  let rawAbbr = ownAbbreviation;
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
  const canonical = canonicalAbbreviation(apiSportsId, rawAbbr);
  return {
    abbreviation:  canonical,
    flag_svg_path: canonical ? flagcdnUrl(canonical) : null,
  };
}
