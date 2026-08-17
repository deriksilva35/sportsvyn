// lib/draft/preset.test.mjs - the practice preset IS the ranked format.
//
// THE PRESET AND THE CONTEST CANNOT SHARE A DEFINITION: one is a row written by
// migrations/068, the other is a constant in lib/draft/contest.js. This test is
// the link between them. If the ranked format changes and the preset does not,
// the practice range quietly starts rehearsing a format nobody plays - which is
// worse than having no preset, because it looks like practice.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { sql } = await import('../db.js');
const { DRAFT_CONFIG, DRAFT_ROUNDS } = await import('./contest.js');

const NAME = 'The Weekly Six';
let row = null;
before(async () => {
  row = (await sql`SELECT * FROM draft_configs WHERE is_preset = true AND name = ${NAME}`)[0] ?? null;
});

test('the preset exists on this database', () => {
  assert.ok(row, `no "${NAME}" preset - migrations/068 has not been applied here`);
});

test('IT MATCHES THE RANKED CONFIG EXACTLY - that is the whole point', () => {
  if (!row) return;
  assert.equal(row.teams_count, DRAFT_CONFIG.teamsCount);
  assert.equal(row.scoring_format, DRAFT_CONFIG.scoringFormat);
  assert.equal(row.pick_timer_seconds, DRAFT_CONFIG.clockSeconds);
  assert.deepEqual(row.roster_slots, DRAFT_CONFIG.rosterSlots,
    'the practice format has drifted from the ranked one');
});

test('and therefore runs the same number of rounds', () => {
  if (!row) return;
  const rounds = Object.values(row.roster_slots).reduce((a, b) => a + Number(b), 0);
  assert.equal(rounds, DRAFT_ROUNDS);
});

test('NO BENCH, NO K, NO DST - every pick counts, as in the ranked room', () => {
  if (!row) return;
  for (const k of ['BENCH', 'K', 'DST', 'SUPERFLEX']) {
    assert.equal(row.roster_slots[k] ?? 0, 0, `${k} has no place in a one-week best-ball format`);
  }
});

test('IT IS FREE, like every preset', () => {
  // The members-only gate is on the CUSTOM console, not the deck. A preset row
  // with is_preset=true is startable through startDraftFor, which checks only
  // the 3-free limit.
  if (!row) return;
  assert.equal(row.is_preset, true);
  assert.equal(row.user_id, null, 'a preset belongs to nobody');
});

test('it drafts against a pool the ADP snapshot already fetches', async () => {
  // config.js caps the snapshot at four pairs as gentle-client discipline. This
  // preset is ppr/12, which is LAUNCH_PRESET_PAIRS[0] - so it costs no new
  // upstream calls. A preset on a fifth pair would need that cap raised.
  const { LAUNCH_PRESET_PAIRS } = await import('../fantasy/config.js');
  assert.ok(
    LAUNCH_PRESET_PAIRS.some((p) => p.scoringFormat === DRAFT_CONFIG.scoringFormat
      && p.teamsCount === DRAFT_CONFIG.teamsCount),
    'the ranked format must draft against a pool we already snapshot',
  );
});
