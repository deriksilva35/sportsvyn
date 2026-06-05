// scripts/backfill-flags.mjs — one-shot backfill for teams.abbreviation +
// teams.flag_svg_path on rows the old upsertTeam (lib/syncFixture pre-fix)
// wrote at NULL.
//
// For every teams row where flag_svg_path IS NULL OR the stored abbreviation
// is a known-colliding value (e.g. 'IRA' before the canonicalization layer
// existed), this script:
//   1. Resolves canonical abbreviation + flag URL via lib/teamFlags.js's
//      shared helper (same one syncFixture.upsertTeam uses), so the
//      collision policy and resolution logic live in ONE place.
//   2. UPDATEs the row's abbreviation (canonicalizing legacy 'IRA' →
//      'IRN' / 'IRQ' for the api_sports IDs in the override map) AND
//      flag_svg_path together.
//
// Per-row outcomes:
//   updated    — wrote canonical abbreviation and/or flag_svg_path
//   unmapped   — abbreviation resolved but lib/flags.js has no ISO mapping
//                for it (rare; means the country isn't in CODE_TO_ISO yet)
//   unresolvable — no abbreviation found anywhere (no cross-league sister
//                row carries one; cannot infer flag)
//
// Run with: node --env-file=.env.local scripts/backfill-flags.mjs

import { sql } from '../lib/db.js';
import { resolveTeamFlagAssets } from '../lib/teamFlags.js';

// Candidate set: rows with NULL flag_svg_path (the primary symptom of the
// old bug). A row whose abbreviation got fixed by a re-sync via the new
// upsertTeam's COALESCE path but whose flag is still NULL also lands here
// — the resolver re-runs end-to-end and fills both.
const rows = await sql`
  SELECT id, slug, name, league_id,
         abbreviation AS own_abbreviation,
         external_ids->>'api_sports' AS api_sports_id
    FROM teams
   WHERE flag_svg_path IS NULL
   ORDER BY id
`;

console.log(`=== Backfill candidates: ${rows.length} teams with NULL flag_svg_path ===\n`);

let updated = 0;
let unmapped = 0;       // resolver returned an abbreviation but flagcdnUrl had no mapping
let unresolvable = 0;   // no abbreviation found anywhere

for (const r of rows) {
  // Pass the row's own (possibly null) abbreviation as ownAbbreviation so
  // the helper short-circuits the cross-league query when we already have
  // a value. excludeTeamId prevents the cross-league lookup from returning
  // *this* row's own (NULL) abbreviation.
  const { abbreviation, flag_svg_path } = await resolveTeamFlagAssets(
    Number(r.api_sports_id),
    { ownAbbreviation: r.own_abbreviation, excludeTeamId: r.id },
  );

  if (!abbreviation) {
    unresolvable++;
    console.log(`  [skip-noabbr]   ${r.name} (id=${r.id}, league=${r.league_id})`);
    continue;
  }
  if (!flag_svg_path) {
    unmapped++;
    console.log(`  [skip-unmapped] ${r.name.padEnd(24)} abbr=${abbreviation.padEnd(4)} (id=${r.id})`);
    continue;
  }

  // UPDATE both columns. We DO overwrite the stored abbreviation when the
  // canonical form differs from the row's current value — that's the
  // entire point of fixing 'IRA' → 'IRN'/'IRQ'. The COALESCE policy in
  // upsertTeam is for the SYNC path (don't clobber good values on every
  // poll tick); this script is the explicit cleanup of known-bad data.
  await sql`
    UPDATE teams
       SET abbreviation = ${abbreviation},
           flag_svg_path = ${flag_svg_path},
           updated_at = now()
     WHERE id = ${r.id}
  `;
  updated++;
  const note = (r.own_abbreviation && r.own_abbreviation !== abbreviation)
    ? `  (canonicalized ${r.own_abbreviation} → ${abbreviation})`
    : '';
  console.log(`  [updated]       ${r.name.padEnd(24)} abbr=${abbreviation.padEnd(4)} → ${flag_svg_path}${note}`);
}

console.log(`\nsummary:`);
console.log(`  updated:      ${updated}`);
console.log(`  unmapped:     ${unmapped}    (had abbreviation but code not in lib/flags.js)`);
console.log(`  unresolvable: ${unresolvable}  (no abbreviation anywhere; cannot infer flag)`);
