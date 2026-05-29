// scripts/backfill-flags.mjs — one-shot backfill for teams.flag_svg_path.
//
// For every teams row with NULL flag_svg_path:
//   1. Try its own abbreviation column.
//   2. If null (e.g. friendlies-league rows where /fixtures didn't give a
//      code), look up ANY teams row sharing the same external_ids api_sports
//      id that DOES have an abbreviation, and use that.
//   3. Pass the resolved abbreviation through flagcdnUrl(); if non-null,
//      UPDATE flag_svg_path on the row.
//
// Reports a per-row outcome: updated, unmapped (abbrev resolved but not in
// our map), or unresolvable (no abbreviation found anywhere).
//
// Run with: node --env-file=.env.local scripts/backfill-flags.mjs

import { sql } from '../lib/db.js';
import { flagcdnUrl } from '../lib/flags.js';

const rows = await sql`
  SELECT
    t.id, t.slug, t.name, t.league_id,
    t.abbreviation AS own_abbreviation,
    (
      SELECT t2.abbreviation FROM teams t2
      WHERE t2.external_ids->>'api_sports' = t.external_ids->>'api_sports'
        AND t2.abbreviation IS NOT NULL
      LIMIT 1
    ) AS cross_abbreviation
  FROM teams t
  WHERE t.flag_svg_path IS NULL
  ORDER BY t.id
`;

console.log(`=== Backfill candidates: ${rows.length} teams with NULL flag_svg_path ===\n`);

let updated = 0;
let unmapped = 0;        // resolved an abbreviation but no flagcdn mapping
let unresolvable = 0;    // no abbreviation found anywhere

for (const r of rows) {
  const abbr = r.own_abbreviation ?? r.cross_abbreviation ?? null;
  if (!abbr) {
    unresolvable++;
    console.log(`  [skip-noabbr]   ${r.name} (id=${r.id}, league=${r.league_id})`);
    continue;
  }
  const url = flagcdnUrl(abbr);
  if (!url) {
    unmapped++;
    console.log(`  [skip-unmapped] ${r.name.padEnd(24)} abbr=${abbr.padEnd(4)} (id=${r.id})`);
    continue;
  }
  await sql`
    UPDATE teams SET flag_svg_path = ${url}, updated_at = now()
    WHERE id = ${r.id}
  `;
  updated++;
  console.log(`  [updated]       ${r.name.padEnd(24)} abbr=${abbr.padEnd(4)} → ${url}`);
}

console.log(`\nsummary:`);
console.log(`  updated:      ${updated}`);
console.log(`  unmapped:     ${unmapped}    (had abbreviation but code not in lib/flags.js)`);
console.log(`  unresolvable: ${unresolvable}  (no abbreviation anywhere; cannot infer flag)`);
