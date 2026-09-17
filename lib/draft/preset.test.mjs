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

// ===========================================================================
// "The Draft" preset IS the ranked room. Same derivation argument, one file up.
// ===========================================================================
// THE WEEKLY SIX'S CAUTIONARY TALE, AVOIDED BY CONSTRUCTION. That preset was
// seeded from a SQL file with the shape retyped as a jsonb literal, and this
// test file exists because a retyped literal is a copy that can drift. THIS row
// is written by scripts/seed-draft-preset.mjs, which reads DRAFT_CONFIG and
// derives every field - so the copy never exists. What a derivation cannot
// prevent is the constant moving AFTER the row was written, and that is exactly
// what the assertions below catch: re-run the seed and they go green again.

const { draftPresetRow, PRESET_NAME, PRESET_DEFAULT_SORT } =
  await import('../../scripts/seed-draft-preset.mjs');

let draftRow = null;
before(async () => {
  draftRow = (await sql`SELECT * FROM draft_configs
                         WHERE is_preset = true AND name = ${PRESET_NAME}`)[0] ?? null;
});

test('"The Draft" preset exists on this database', () => {
  assert.ok(draftRow, `no "${PRESET_NAME}" preset - run scripts/seed-draft-preset.mjs here`);
});

test('IT IS THE RANKED ROOM, FIELD FOR FIELD - the drift test', () => {
  if (!draftRow) return;
  const derived = draftPresetRow();
  assert.deepEqual(draftRow.roster_slots, derived.roster_slots,
    'the practice format has drifted from DRAFT_CONFIG - re-run scripts/seed-draft-preset.mjs');
  assert.equal(draftRow.teams_count, derived.teams_count);
  assert.equal(draftRow.scoring_format, derived.scoring_format);
  assert.equal(draftRow.pick_timer_seconds, derived.pick_timer_seconds);
  assert.equal(draftRow.is_preset, true);
  assert.equal(draftRow.user_id, null, 'a preset belongs to nobody');
});

test('EIGHT ROUNDS, because the ranked room drafts eight', () => {
  if (!draftRow) return;
  const rounds = Object.values(draftRow.roster_slots).reduce((a, b) => a + Number(b), 0);
  assert.equal(rounds, DRAFT_ROUNDS);
  assert.equal(rounds, 8);
});

test('NOTHING ABOUT THE FORMAT IS TYPED IN THE SEED - it is all derived', () => {
  const src = readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'seed-draft-preset.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('export function draftPresetRow'), src.indexOf('async function main'));
  for (const field of ['teams_count: DRAFT_CONFIG.teamsCount', 'scoring_format: DRAFT_CONFIG.scoringFormat',
    'roster_slots: DRAFT_CONFIG.rosterSlots', 'pick_timer_seconds: DRAFT_CONFIG.clockSeconds']) {
    assert.ok(fn.includes(field), `${field} must be read off the constant, not typed`);
  }
  assert.doesNotMatch(fn, /\b12\b|\bppr\b|\b30\b/, 'no value of the ranked format appears as a literal');
});

test('ITS ROOM OPENS ON THIS SEASON, and that key is a sort the room offers', async () => {
  const { sortsFor } = await import('../fantasy/statView.js');
  const offered = sortsFor('ALL').map((o) => o.key);
  assert.ok(offered.includes(PRESET_DEFAULT_SORT),
    `default_sort "${PRESET_DEFAULT_SORT}" is not a sort the room offers`);
  // AND IT IS OFFERED UNDER EVERY POSITION TAB, which is the ruling's "position
  // tabs sort the same" - PPG is UNIVERSAL, so narrowing to QB keeps the sort
  // rather than silently dropping back to the board order.
  for (const pos of ['QB', 'RB', 'WR', 'TE']) {
    assert.ok(sortsFor(pos).map((o) => o.key).includes(PRESET_DEFAULT_SORT),
      `the ${pos} tab must offer ${PRESET_DEFAULT_SORT} too`);
  }
  if (draftRow) assert.equal(draftRow.default_sort, PRESET_DEFAULT_SORT);
});

test('THE DECK ORDER: The Draft first, The Weekly Six second, then id', async () => {
  const { getPresets } = await import('../fantasy/drafts.js');
  const presets = await getPresets();
  assert.ok(presets.length >= 2);
  assert.equal(presets[0].name, PRESET_NAME, 'the ranked rehearsal leads the deck');
  assert.equal(presets[1].name, NAME, "and The Weekly's is second");
  const rest = presets.slice(2).map((p) => p.id);
  assert.deepEqual(rest, [...rest].sort((a, b) => a - b), 'the casual shapes keep insertion order');
  // The order is by NAME, never by id - the ids differ per database.
  const src = readFileSync(path.resolve(__dirname, '..', 'fantasy', 'drafts.js'), 'utf8');
  const fn = src.slice(src.indexOf('export async function getPresets'), src.indexOf('export async function getMyLeagues'));
  assert.match(fn, /ORDER BY \(name = 'The Draft'\) DESC, \(name = 'The Weekly Six'\) DESC, id/);
  assert.match(fn, /default_sort/, 'the deck reads the sort its cards describe');
});

test('THE ROOM SEEDS ITS SORT FROM THE CONFIG, not from a literal in the component', () => {
  const room = readFileSync(path.resolve(__dirname, '..', '..', 'components', 'sim', 'DraftRoom.js'), 'utf8');
  assert.match(room, /useState\(config\?\.default_sort \?\? 'adp'\)/);
  const cfg = readFileSync(path.resolve(__dirname, '..', 'fantasy', 'drafts.js'), 'utf8');
  const load = cfg.slice(cfg.indexOf('async function loadConfig'), cfg.indexOf('// THE SINGLE WRITER'));
  assert.match(load, /default_sort/, 'loadConfig must carry it or the room can never see it');
});

test('THE DECK SAYS WHAT THE ROOM WILL DO', () => {
  const form = readFileSync(path.resolve(__dirname, '..', '..', 'components', 'sim', 'StartForm.js'), 'utf8');
  assert.match(form, /RANKED_PRESETS = new Map\(\[/);
  assert.match(form, /\['The Draft', \{/);
  assert.match(form, /\['The Weekly Six', \{/);
  // Each card says its format in the same grammar, and each says which board
  // it drafts - the two facts a reader chooses between.
  assert.ok(form.includes("12 · PPR · 8 rounds · the Draft's exact board · sorted by this season"));
  assert.ok(form.includes("12 · PPR · 6 rounds · the Weekly's exact board"));
  // ONE BORDER, ONE TAG, AND THEY ARE THE SAME CARD. Two marked cards on a
  // six-card rail is a rail with no emphasis.
  assert.match(form, /tag: 'THE DRAFT'/);
  const draft = form.slice(form.indexOf("['The Draft', {"), form.indexOf("['The Weekly Six', {"));
  const weekly = form.slice(form.indexOf("['The Weekly Six', {"), form.indexOf(']);', form.indexOf("['The Weekly Six', {")));
  assert.match(draft, /border: true/);
  assert.match(weekly, /border: false/);
  assert.match(weekly, /tag: null/);
  // And the border is drawn from that flag, not from mere membership.
  assert.match(form, /RANKED_PRESETS\.get\(p\.name\)\?\.border \? ' pcard--ranked' : ''/);
});

test('it drafts the pool every preset drafts - our own board', async () => {
  // Presets go through startDraftFor, which now builds lib/draft/ourBoard.js
  // for any config whose pool_source is 'ffc'. This preset is one of those, so
  // it needs no new upstream cost and no new pool pair.
  const src = readFileSync(path.resolve(__dirname, '..', 'fantasy', 'drafts.js'), 'utf8');
  const fn = src.slice(src.indexOf('export async function startDraftFor'), src.indexOf('export async function startLeagueDraftFor'));
  assert.match(fn, /ourBoard\(\{/);
  assert.match(fn, /pool_source: board \? OUR_SOURCE : config\.pool_source/);
});
