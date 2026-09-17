// scripts/seed-draft-preset.mjs — "The Draft" preset: practice for the ranked game.
//
// A SCRIPT RATHER THAN A MIGRATION, deliberately. 068 seeded The Weekly Six
// from a SQL file, and its own header names the problem that caused: a JS
// constant and a SQL literal cannot share a definition, so the row was pinned
// to DRAFT_CONFIG by a test after the fact. This row is DERIVED from
// DRAFT_CONFIG at insert time - teams, scoring, slots and clock all read off
// the constant - so the copy never exists in the first place. The drift test in
// lib/draft/preset.test.mjs then guards the row against a LATER change to the
// constant, which is the only drift a derivation cannot prevent.
//
// IDEMPOTENT, AND IT UPDATES. Re-running after DRAFT_CONFIG changes brings the
// row back into line rather than refusing; that is the whole reason it is a
// script you can run again. It touches exactly one row, matched by name.
//
// CREDENTIAL FROM THE ENVIRONMENT, never inline (CLAUDE.md). Source with
//   set -a && . ./.env.local && set +a
// and select the database with --prod (PROD_DATABASE_URL) or the default
// DATABASE_URL. --dry prints the row and writes nothing.
//
//   node scripts/seed-draft-preset.mjs --dry
//   node scripts/seed-draft-preset.mjs             # DEV
//   node scripts/seed-draft-preset.mjs --prod      # PROD, on the GO

import { neon } from '@neondatabase/serverless';
import { DRAFT_CONFIG, DRAFT_ROUNDS } from '../lib/draft/contest.js';

export const PRESET_NAME = 'The Draft';
/** The sort its room opens on: this season's PPG, nulls last. */
export const PRESET_DEFAULT_SORT = 'ppg';

/** The row, DERIVED - nothing about the format is typed here. */
export function draftPresetRow() {
  return {
    user_id: null,
    name: PRESET_NAME,
    teams_count: DRAFT_CONFIG.teamsCount,
    scoring_format: DRAFT_CONFIG.scoringFormat,
    roster_slots: DRAFT_CONFIG.rosterSlots,
    pick_timer_seconds: DRAFT_CONFIG.clockSeconds,
    is_preset: true,
    source: 'launch',
    default_sort: PRESET_DEFAULT_SORT,
  };
}

async function main() {
  const prod = process.argv.includes('--prod');
  const dry = process.argv.includes('--dry');
  const url = prod ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error(`${prod ? 'PROD_DATABASE_URL' : 'DATABASE_URL'} not set in environment`);
  const row = draftPresetRow();

  console.log(`target: ${prod ? 'PROD' : 'DEV'}${dry ? '  (DRY RUN - nothing is written)' : ''}`);
  console.log(`row:    ${JSON.stringify(row)}`);
  console.log(`rounds: ${DRAFT_ROUNDS} (derived from the same slots)`);
  if (dry) return;

  const sql = neon(url);
  const [col] = await sql`SELECT 1 AS ok FROM information_schema.columns
                           WHERE table_name = 'draft_configs' AND column_name = 'default_sort'`;
  if (!col) throw new Error('draft_configs.default_sort is missing - apply migrations/104 first');

  const [existing] = await sql`SELECT id FROM draft_configs
                                WHERE is_preset = true AND name = ${row.name} LIMIT 1`;
  if (existing) {
    await sql`UPDATE draft_configs
                 SET teams_count = ${row.teams_count}, scoring_format = ${row.scoring_format},
                     roster_slots = ${JSON.stringify(row.roster_slots)}::jsonb,
                     pick_timer_seconds = ${row.pick_timer_seconds},
                     default_sort = ${row.default_sort}
               WHERE id = ${existing.id}`;
    console.log(`updated preset id ${existing.id}`);
  } else {
    const [ins] = await sql`INSERT INTO draft_configs
        (user_id, name, teams_count, scoring_format, roster_slots, pick_timer_seconds,
         is_preset, source, default_sort)
      VALUES (NULL, ${row.name}, ${row.teams_count}, ${row.scoring_format},
              ${JSON.stringify(row.roster_slots)}::jsonb, ${row.pick_timer_seconds},
              true, ${row.source}, ${row.default_sort})
      RETURNING id`;
    console.log(`inserted preset id ${ins.id}`);
  }

  const presets = await sql`SELECT id, name, default_sort FROM draft_configs
                             WHERE is_preset = true
                             ORDER BY (name = ${PRESET_NAME}) DESC, (name = 'The Weekly Six') DESC, id`;
  console.log('deck order now:');
  for (const p of presets) console.log(`  ${String(p.id).padStart(6)}  ${String(p.name).padEnd(22)} sort ${p.default_sort ?? '-'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
