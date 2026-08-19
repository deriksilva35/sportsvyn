// lib/draft/preset.test.mjs - "The Weekly Six" preset IS The Weekly.
//
// THE PRESET AND THE GAME CANNOT SHARE A DEFINITION: one is a database row
// (068, reshaped by 071), the other is lib/weekly/rules.js SLOTS. This test is
// the link between them - and its first version is the cautionary tale: it
// pinned this preset to DRAFT_CONFIG, The DRAFT's ranked format, so the name
// said The Weekly, the shape said The Draft, and the drift test ENFORCED the
// mismatch. A drift test is only as good as its referent. The referent now is
// The Weekly's own slot list, derived - not retyped - so the two cannot part.
//
// The Draft's 8-round law did not leave: it moved to the DRAFT_CONFIG
// assertions at the bottom, where it is a claim about contest 3's constant
// rather than about this preset.

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
const { SLOTS } = await import('../weekly/rules.js');

// The Weekly's roster_slots shape, DERIVED from its slot list: FLEX and FLEX2
// are two of one kind. Deriving is the point - a retyped literal here would be
// a third copy of the format for the other two to drift from.
const WEEKLY_SHAPE = {};
for (const slot of SLOTS) {
  const k = slot.startsWith('FLEX') ? 'FLEX' : slot;
  WEEKLY_SHAPE[k] = (WEEKLY_SHAPE[k] ?? 0) + 1;
}

const NAME = 'The Weekly Six';
let row = null;
before(async () => {
  row = (await sql`SELECT * FROM draft_configs WHERE is_preset = true AND name = ${NAME}`)[0] ?? null;
});

test('the preset exists on this database', () => {
  assert.ok(row, `no "${NAME}" preset - migrations/068 has not been applied here`);
});

test("IT MATCHES THE WEEKLY'S OWN SLOTS EXACTLY - that is the whole point", () => {
  if (!row) return;
  assert.deepEqual(row.roster_slots, WEEKLY_SHAPE,
    "the practice format has drifted from The Weekly's - check lib/weekly/rules.js SLOTS vs migration 071");
});

test('SIX PICKS, because The Weekly is six slots - no more, no fewer', () => {
  if (!row) return;
  const rounds = Object.values(row.roster_slots).reduce((a, b) => a + Number(b), 0);
  assert.equal(rounds, SLOTS.length, `the preset drafts ${rounds}, The Weekly plays ${SLOTS.length}`);
  assert.equal(rounds, 6);
});

test('PPR in a 12-team room - Weekly scoring, practice-sized opposition', () => {
  if (!row) return;
  assert.equal(row.scoring_format, 'ppr', 'The Weekly is PPR drop-worst');
  assert.equal(row.teams_count, 12, 'a practice mock needs opponents; The Weekly itself has none');
});

test("THE DRAFT'S EIGHT-ROUND LAW STANDS - on contest 3's constant, not here", () => {
  // Ruled and re-pinned where it belongs. The ranked room drafts eight so
  // rounds seven and eight cost something; this preset stopped being its
  // rehearsal in 071 and the law must not have left with it.
  const rounds = Object.values(DRAFT_CONFIG.rosterSlots).reduce((a, b) => a + Number(b), 0);
  assert.equal(rounds, DRAFT_ROUNDS);
  assert.equal(rounds, 8, 'the ranked draft is eight rounds');
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
