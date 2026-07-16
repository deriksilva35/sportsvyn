// lib/fantasy/roster.test.mjs - lineup-order roster rules.
// Config fixtures below are the REAL shipped preset roster_slots rows, copied
// from migration 046's seed (draft_configs, is_preset = true) and verified
// against DEV. Key order is reproduced verbatim, including K BEFORE DST, because
// that jsonb ordering is exactly what these rules must not inherit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { orderedSlots, buildRoster } from './roster.js';

const STANDARD_12_PPR = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 };
const TWELVE_TEAM_2QB = { QB: 2, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 5 };
const labels = (slots) => slots.map((s) => s.label);

test('Standard 12 PPR renders starters in lineup order, bench last', () => {
  assert.deepEqual(labels(orderedSlots(STANDARD_12_PPR)), [
    'QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'DST', 'K',
    'BN1', 'BN2', 'BN3', 'BN4', 'BN5', 'BN6',
  ]);
});

test('display order beats jsonb key order: DST precedes K despite the config', () => {
  // The preset row stores K before DST; the roster must still read DST then K.
  assert.ok(Object.keys(STANDARD_12_PPR).indexOf('K') < Object.keys(STANDARD_12_PPR).indexOf('DST'));
  const l = labels(orderedSlots(STANDARD_12_PPR));
  assert.ok(l.indexOf('DST') < l.indexOf('K'));
});

test('slot counts stay config-driven: 2QB preset numbers QB1/QB2 with no hardcoding', () => {
  const l = labels(orderedSlots(TWELVE_TEAM_2QB));
  assert.deepEqual(l.slice(0, 3), ['QB1', 'QB2', 'RB1']);
  assert.equal(l.filter((x) => x.startsWith('BN')).length, 5);
});

test('every preset totals 15 rounds (slot count is read, never assumed)', () => {
  for (const cfg of [STANDARD_12_PPR, TWELVE_TEAM_2QB]) {
    assert.equal(orderedSlots(cfg).length, Object.values(cfg).reduce((a, b) => a + b, 0));
    assert.equal(orderedSlots(cfg).length, 15);
  }
});

test('a slot the order list does not name still renders, before the bench', () => {
  // config-driven-everything: a new preset slot must never silently vanish.
  const l = labels(orderedSlots({ QB: 1, RB: 1, SUPERFLEX: 1, BN: 1 }));
  assert.deepEqual(l, ['QB', 'RB', 'SUPERFLEX', 'BN1']);
});

test('picks fill their engine-assigned slot; a second TE overflows to bench', () => {
  const picks = [
    { overallPick: 1, rosterSlot: 'RB', playerName: 'Gibbs' },
    { overallPick: 2, rosterSlot: 'TE', playerName: 'Bowers' },
    { overallPick: 3, rosterSlot: 'RB', playerName: 'Robinson' },
    { overallPick: 4, rosterSlot: 'BN', playerName: 'Second TE' },
  ];
  const byLabel = Object.fromEntries(buildRoster(picks, STANDARD_12_PPR).map((s) => [s.label, s.pick?.playerName ?? null]));
  assert.equal(byLabel.RB1, 'Gibbs');
  assert.equal(byLabel.RB2, 'Robinson');
  assert.equal(byLabel.TE, 'Bowers');
  assert.equal(byLabel.BN1, 'Second TE');
  assert.equal(byLabel.QB, null); // unfilled starters stay open placeholders
});

test('overflow past a full bench is dropped, not crashed on', () => {
  // Placement follows the pick's engine-assigned rosterSlot, so 40 RB-slotted
  // picks fill RB1/RB2 and then the 6 bench rows (8), never FLEX. The rest have
  // nowhere legal to go and are dropped rather than throwing. This roster cannot
  // occur in a real draft (canRoster bars it) - the case is here to pin the
  // renderer's behaviour if a pick ever arrives with no home.
  const many = Array.from({ length: 40 }, (_, i) => ({ overallPick: i + 1, rosterSlot: 'RB', playerName: `RB${i}` }));
  const slots = buildRoster(many, STANDARD_12_PPR);
  assert.equal(slots.length, 15);
  assert.equal(slots.filter((s) => s.pick).length, 8);
  assert.deepEqual(slots.filter((s) => s.pick).map((s) => s.label),
    ['RB1', 'RB2', 'BN1', 'BN2', 'BN3', 'BN4', 'BN5', 'BN6']);
});

test('picks are placed in draft order regardless of input order', () => {
  const shuffled = [
    { overallPick: 9, rosterSlot: 'RB', playerName: 'Later' },
    { overallPick: 2, rosterSlot: 'RB', playerName: 'Earlier' },
  ];
  const byLabel = Object.fromEntries(buildRoster(shuffled, STANDARD_12_PPR).map((s) => [s.label, s.pick?.playerName ?? null]));
  assert.equal(byLabel.RB1, 'Earlier');
  assert.equal(byLabel.RB2, 'Later');
});
