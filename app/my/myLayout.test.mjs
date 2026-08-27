// app/my/myLayout.test.mjs - the dashboard's grid, its customize chrome, and
// the three states of Your Schedule.
//
// THE FAILURE THIS FILE EXISTS FOR: a CSS class that is emitted by markup and
// defined nowhere. It is not an error. Nothing logs, nothing throws, the
// element simply has no layout - which is exactly why Phase 1 shipped a
// 12-column grid whose per-panel span rules named panels that no longer
// existed. So both directions are asserted here: every class the markup emits
// has a definition, and no rule names a retired panel.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANELS } from '../../lib/panels.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
// COMMENTS STRIPPED. The file explains the defect by NAMING the retired
// selectors it removed - `.panel-live`, `:has(.panel-X)` - and a raw scan reads
// that explanation as the offence. Fourth time this trap has fired in this
// codebase; it is always the same shape.
const cssRaw = src('app/my/my.css');
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const customizer = src('app/my/CustomizeClient.js');

const emittedClasses = (js) => {
  const out = new Set();
  for (const m of js.matchAll(/className=["`]([^"`{]+)["`]/g)) {
    m[1].split(/\s+/).filter(Boolean).forEach((c) => out.add(c));
  }
  for (const m of js.matchAll(/className=\{`([^`]+)`\}/g)) {
    (m[1].match(/[a-z][a-z0-9-]+/g) ?? []).forEach((c) => out.add(c));
  }
  return out;
};

// A real selector, not a substring: `.c` must not be satisfied by `.customize`.
const hasDefinition = (c) =>
  new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![a-zA-Z0-9_-])`).test(css);

test('THE GRID IS CONTENT-SIZED, and names no panel', () => {
  // The defect: `repeat(12, 1fr)` plus one `grid-column: span N` per panel id.
  // Phase 1 renamed every panel, so no id selector matched and each card fell
  // back to `grid-column: auto` - one column of twelve. Hence My Fantasy
  // clipping off the right edge and one-word-per-line wrapping.
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(320px,\s*1fr\)\)/);
  // No rule may depend on knowing a panel's name.
  for (const dead of ['panel-live', 'panel-today-next', 'panel-goldenboot',
                      'panel-groups', 'panel-mentioned', 'panel-market',
                      'panel-schedule', 'panel-watch', 'panel-players',
                      'panel-rankings']) {
    assert.ok(!css.includes(dead), `${dead} must not be referenced by the grid`);
  }
  // And none of the NEW ids either - the whole point is that the grid does not
  // have to be taught the next panel's name.
  for (const id of Object.keys(PANELS)) {
    assert.ok(!css.includes(`.panel-${id}`), `.panel-${id} must not be needed`);
  }
});

test('THE MOCK IS THE AUTHORITY AT 430px AND UNDER', () => {
  assert.match(css, /@media \(max-width: 430px\) \{\s*\.my-grid \{ grid-template-columns: 1fr; \}/);
});

test('the hero spans full width at every breakpoint', () => {
  // It is not a panel: it cannot be reordered or removed, and there is exactly
  // one primary button on the screen.
  assert.match(css, /\.my-shell \.hero \{ grid-column: 1 \/ -1; \}/);
});

test('EVERY CLASS THE CUSTOMIZER EMITS HAS A CSS DEFINITION', () => {
  // The both-sides assertion. `customize` and `togglable` were emitted with no
  // definition at all - no error, no layout, no way to notice.
  const missing = [...emittedClasses(customizer)].filter((c) => !hasDefinition(c));
  assert.deepEqual(missing, [], `classes with no CSS definition: ${missing.join(', ')}`);
});

test('the customize slot is a plain grid item, not a re-spanned wrapper', () => {
  // Nine `:has(.panel-X)` rules used to re-apply the 12-column spans to the
  // wrapper so edit mode matched normal mode. With auto-fill there is nothing
  // to re-apply - and the slot inheriting a 1/12 width is what made the control
  // strip overlap its neighbours.
  assert.ok(!css.includes(':has(.panel-'), 'the :has() span rules must be gone');
  assert.match(css, /\.my-grid \.panel-slot \{ display: block; min-width: 0; \}/);
  // The chrome sits inside the card.
  assert.match(css, /\.my-grid \.panel-slot \.pedit \{ margin-bottom: 8px; \}/);
});

test('YOUR SCHEDULE HAS THREE STATES, not two', () => {
  // "You follow nobody" and "your teams have nothing scheduled" are different
  // facts. Collapsing them told a user with three World Cup follows that they
  // had never followed anyone.
  const panels = src('components/my/panels.js');
  const fn = panels.slice(panels.indexOf('export function SchedulePanel'),
                          panels.indexOf('export function YourPlayersPanel'));
  assert.match(fn, /if \(!games\?\.length && followCount > 0\)/, 'follows, no games');
  assert.match(fn, /No upcoming games for teams you follow\./);
  assert.match(fn, /cta="Browse teams"/);
  assert.match(fn, /<Prompt line="Follow teams/, 'genuinely zero follows');
  // The count has to reach the panel, or the two states collapse again.
  assert.match(src('lib/panelLoaders.js'), /followCount: ids\?\.size \?\? ids\?\.length \?\? 0/);
});
