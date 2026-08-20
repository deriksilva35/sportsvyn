// lib/fantasy/handoff.test.mjs - the Mock -> Tracker handoff and the console
// parity behind it. The scoresNav law restated: one builder, one parser,
// round-tripped - a handoff cannot produce state the tracker cannot read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackerHandoffHref, parseTrackerHandoff } from './handoff.js';
import { SLOT_KEYS, ROSTER_CELLS, deriveRounds } from './config.js';
import { BENCH } from './roster.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sp = (href) => Object.fromEntries(new URL(href, 'https://x').searchParams);

// ---------------------------------------------------------------------------
// round trip
// ---------------------------------------------------------------------------

const CONFIGS = [
  { teamsCount: 12, scoringFormat: 'ppr', rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1, BN: 6 } },
  { teamsCount: 10, scoringFormat: 'half-ppr', rosterSlots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, BN: 5 } },
  { teamsCount: 14, scoringFormat: '2qb', rosterSlots: { QB: 2, RB: 2, WR: 2, TE: 1, SUPERFLEX: 1, BN: 7 } },
  { teamsCount: 8, scoringFormat: 'standard', rosterSlots: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 2 } },
];

test('every config round-trips whole - teams, scoring, roster, bench', () => {
  for (const c of CONFIGS) {
    const back = parseTrackerHandoff(sp(trackerHandoffHref(c)));
    assert.deepEqual(back, {
      teamsCount: c.teamsCount, scoringFormat: c.scoringFormat, rosterSlots: c.rosterSlots,
    }, JSON.stringify(c.rosterSlots));
    assert.equal(deriveRounds(back.rosterSlots), deriveRounds(c.rosterSlots),
      'rounds must survive the trip - they derive from what rode it');
  }
});

test('the seat never rides - picking it is the tracker screen\'s job', () => {
  const href = trackerHandoffHref({ ...CONFIGS[0], pickPosition: 4, seat: 4 });
  assert.ok(!href.includes('seat'), href);
  assert.ok(!href.includes('pick'), href);
});

test('all-or-nothing: any malformed part voids the WHOLE handoff', () => {
  const good = sp(trackerHandoffHref(CONFIGS[0]));
  for (const bad of [
    { ...good, teams: '99' },              // outside TEAMS bounds
    { ...good, teams: 'twelve' },
    { ...good, scoring: 'dynasty' },       // unknown format
    { ...good, roster: 'QB1-XX2' },        // unknown slot key
    { ...good, roster: 'QB1-QB2' },        // duplicate key
    { ...good, roster: 'QB99' },           // outside SLOT_BOUNDS
    { ...good, roster: '' },
    { ...good, from: 'elsewhere' },        // not a mock handoff
    {},
  ]) {
    assert.equal(parseTrackerHandoff(bad), null, JSON.stringify(bad));
  }
});

test('junk keys in the URL are ignored, not fatal - links get decorated', () => {
  const good = sp(trackerHandoffHref(CONFIGS[0]));
  assert.notEqual(parseTrackerHandoff({ ...good, utm_source: 'x', shell: 'sim-app' }), null);
});

// ---------------------------------------------------------------------------
// console parity - one definition, two consoles
// ---------------------------------------------------------------------------

test('ROSTER_CELLS derives from SLOT_KEYS - every non-bench slot, no extras', () => {
  assert.deepEqual(ROSTER_CELLS.map((c) => c.k), SLOT_KEYS.filter((k) => k !== BENCH));
});

test('both consoles render ROSTER_CELLS from the shared definition, not a copy', () => {
  for (const rel of ['components/sim/StartForm.js', 'components/sim/TrackerStart.js']) {
    const t = stripComments(src(rel));
    assert.match(t, /ROSTER_CELLS/, `${rel} must render the shared cells`);
    assert.ok(!/\{ k: 'QB', label/.test(t), `${rel} hand-writes a slot list - the drift-test law`);
  }
});

test('the tracker console derives rounds and starts from the 15-round default', () => {
  const t = stripComments(src('components/sim/TrackerStart.js'));
  assert.match(t, /deriveRounds\(slots\)/, 'rounds are never stored, always derived');
  assert.match(t, /QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6/, 'the common real-league shape');
  assert.match(t, /rosterSlots: slots/, 'the STARTED draft must use the edited slots, not the default');
});

// ---------------------------------------------------------------------------
// the wiring - live link on the Mock, parsed prop on the Tracker
// ---------------------------------------------------------------------------

test('the Mock link carries the LIVE config through the one builder', () => {
  const form = stripComments(src('components/sim/StartForm.js'));
  assert.match(form, /trackerHandoffHref\(config\)/, 'a static href can only ever send defaults');
  assert.match(form, /<Link className="sim-trklink"/, 'soft nav - the Link law');
  const page = stripComments(src('app/sim/page.js'));
  assert.ok(!page.includes('sim-trklink'), 'the page-level static link must be gone, not doubled');
});

test('the tracker page hands the parsed handoff to the console', () => {
  const t = stripComments(src('app/sim/tracker/page.js'));
  assert.match(t, /initial=\{parseTrackerHandoff\(params\)\}/);
});
