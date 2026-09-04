// lib/footballdb/teamKeyDuplicates.test.mjs — no (nfl_player_id,
// season_year) pair among footballdb rows may carry two rows whose
// team_keys resolve to the SAME canonical team. A traded player legitimately
// keeps two rows for a season because his two team_keys are genuinely
// different teams (migrations/089's ruling, never merged) - this guards
// against the OTHER shape, the one scripts/footballdb-import.mjs used to
// produce before canonicalTeamKey() existed: the same team written twice,
// once abbreviated and once raw, because the ingest built its ON CONFLICT
// key from the raw name every re-run. Real DEV data, read-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../db.js';
import { canonicalTeamKey } from './teamKey.js';

test('no footballdb (player, season) pair has two rows resolving to the same canonical team', async () => {
  const teams = await sql`SELECT t.name, t.abbreviation FROM teams t JOIN leagues l ON l.id = t.league_id WHERE l.slug = 'nfl'`;
  const byName = new Map(teams.map((t) => [t.name.toLowerCase(), t.abbreviation]));
  const resolver = (name) => byName.get(name.toLowerCase()) ?? null;

  const rows = await sql`SELECT nfl_player_id, season_year, team_key FROM nfl_player_season_totals WHERE source = 'footballdb'`;

  const byPlayerSeason = new Map();
  for (const r of rows) {
    const k = `${r.nfl_player_id}|${r.season_year}`;
    if (!byPlayerSeason.has(k)) byPlayerSeason.set(k, []);
    byPlayerSeason.get(k).push(canonicalTeamKey(r.team_key, resolver));
  }

  const violations = [];
  for (const [k, canonKeys] of byPlayerSeason) {
    if (new Set(canonKeys).size < canonKeys.length) violations.push({ k, canonKeys });
  }

  assert.deepEqual(violations, [], `same-canonical-team duplicate rows found: ${JSON.stringify(violations.slice(0, 10))}`);
});
