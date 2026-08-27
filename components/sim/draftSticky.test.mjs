// components/sim/draftSticky.test.mjs - one sticky element per scroller.
//
// THE DEFECT: on the pager the PAGE is the scroller, so .plabel and .nhead were
// both sticky inside it, and the header's top offset was a hand-measured
// approximation of the label's height ("~32px: 20px padding + 11px line +
// border"). When the real height disagreed, rows scrolled through the gap
// between them - half-clipped above the band, hidden behind it - during a live
// draft with the clock running.
//
// A rule that has to be taught the rendered height of a different element is
// the same failure family as a grid that names panels by id.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const simCss = strip(src('components/sim/sim.css'));

test('NO ASSUMED STACK HEIGHT - the magic 32px is gone', () => {
  assert.ok(!/--nhead-top:\s*32px/.test(simCss),
    'the column header must not be offset by a measurement of another element');
  assert.match(simCss, /\.pager \.page \.nhead \{ --nhead-top: 0px;/);
});

test('the pager page has exactly ONE sticky element in its scroller', () => {
  // .plabel joins .pg-board's existing `position: static` treatment - that page
  // already did this, which is precedent rather than invention.
  assert.match(simCss, /\.pager \.page \.plabel \{ position: static; \}/);
  assert.match(simCss, /\.room--board \.pg-board \.plabel \{ position: static; \}/);
});

test('the sticky rule itself is still shared and still var-driven', () => {
  // numcols.css owns the mechanism; sim.css only supplies offset and surface.
  const numcols = strip(src('components/sim/numcols.css'));
  assert.match(numcols, /position: sticky; top: var\(--nhead-top, 0px\)/);
  assert.match(numcols, /background: var\(--nhead-bg/);
});

test('NO ROW RENDERS HALF-VISIBLE under the pinned header', () => {
  assert.match(simCss, /\.pager \.page \.p-row \{ scroll-margin-top: 34px; \}/);
});

test('TRACKER IS UNTOUCHED - it never set an offset', () => {
  // TrackerRoom renders the same .nhead, so a change to the shared rule would
  // have reached it. It uses the 0px default and its own scroller, and this
  // relay changed neither.
  assert.match(src('components/sim/TrackerRoom.js'), /className="trk-p nhead"/);
  assert.ok(!/--nhead-top/.test(strip(src('components/sim/tracker.css'))),
    'tracker sets no offset and must not need one');
});

test('the draft room header still names all three columns', () => {
  // De-stickying the LABEL, not the header: VAL is named nowhere else - the
  // sort row offers ADP, My Team, PPG and PTS - so the column header had to
  // stay pinned.
  const room = src('components/sim/DraftRoom.js');
  const head = room.slice(room.indexOf('className="p-row nhead"'), room.indexOf('</div>', room.indexOf('className="p-row nhead"')) + 6);
  for (const c of ['PPG', 'ADP', 'VAL']) assert.ok(head.includes(c), `${c} label`);
});
