// components/games/octRunOneScroll.test.mjs - October and The Run in one scroll
// (thu-7), as CSS and source facts; the DOM half is in octoberCard.test.mjs and
// runRoster.test.mjs. The Weekly's pattern (components/weekly/weeklyOneScroll):
// the picker sticks at the top, the list's header with it, the rows are the
// page's own scroll, and nothing in between is a scroll container.
//
// Measured at 390x844 (PROD's public October day 29; The Run's round 30
// re-opened synthetically in a harness, since every club had started): first
// pickable row top, app shell / web -
//   October  before 487 / 495 in a 439px inner box   after 474 / 482, no inner box
//   The Run  before 677 / 685 in a 439px inner box   after 664 / 672, no inner box

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(path.join(REPO, f), 'utf8');
const ARC = ':where(:root[data-theme="arcade"])';
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function arcade(css, sel) {
  const out = [];
  for (const m of strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((x) => x.trim()).includes(`${ARC} ${sel}`)) out.push(m[2]);
  }
  return out.join(';');
}

for (const [name, cssFile, src, p] of [
  ['October', 'app/october/october.css', 'components/october/OctoberCard.js', 'oc'],
  ['The Run', 'app/run/run.css', 'components/run/RunRoster.js', 'rn'],
]) {
  const css = read(cssFile);
  const code = read(src);

  test(`${name}: the dock is sticky under the site bar, and the card does not trap it`, () => {
    const dock = arcade(css, `.${p}-dock`);
    assert.match(dock, /position:\s*sticky/);
    assert.match(dock, /top:\s*var\(--gi-stick, 0px\)/);
    assert.match(dock, /background:\s*var\(--ink\)/, 'opaque, so rows pass under it');
    // hidden would make the card the dock's scrollport, which never scrolls
    assert.match(arcade(css, `.${p}`), /overflow:\s*clip/);
    assert.match(arcade(css, `.${p}-panel`), /overflow:\s*clip/);
    assert.match(code, /useStickyOffset\(rootRef\)/);
    assert.match(code, new RegExp(`<div className="${p}" data-phase=\\{view\\.phase\\} ref=\\{rootRef\\}>`));
  });

  test(`${name}: NO INNER SCROLL BOX - the list is the page's scroll under arcade`, () => {
    const b = arcade(css, `.${p}-pan-b`);
    assert.match(b, /max-height:\s*none/);
    assert.match(b, /overflow:\s*visible/);
    for (const sel of [`.${p}-dock`, `.${p}-panel`, `.${p}-dock .${p}-field`, `.${p}-dock .${p}-form`, `.${p}-dock .${p}-pan-h`]) {
      assert.doesNotMatch(arcade(css, sel), /overflow(-y)?:\s*(auto|scroll)|max-height:\s*\d/, `${sel} does not scroll`);
    }
  });

  test(`${name}: the slots are one compact grid of five columns in the dock`, () => {
    assert.match(arcade(css, `.${p}-dock .${p}-form`), /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
    assert.match(arcade(css, `.${p}-dock .${p}-slot`), /aspect-ratio:\s*auto;\s*height:\s*\d+px/);
  });

  test(`${name}: "How it works" is one row - a <details> with a 34px summary`, () => {
    assert.match(code, new RegExp(`<details className="${p}-steps ${p}-how">`));
    assert.match(code, /<summary>How it works<\/summary>/);
    assert.match(arcade(css, `.${p}-how > summary`), /height:\s*34px/);
  });

  test(`${name}: no bottom bar to gate - the footer stays in flow`, () => {
    assert.doesNotMatch(strip(css), new RegExp(`\\.${p}-ft[^{]*\\{[^}]*position:\\s*(sticky|fixed)`));
  });
}

test('October: the chips are IN the dock, and a new game\'s list starts at its top', () => {
  const code = read('components/october/OctoberCard.js');
  const dock = code.slice(code.indexOf('<div className="oc-dock" ref={dockRef}>'), code.indexOf('{err ? <p className="oc-err"'));
  assert.match(dock, /<div className="oc-grid">/);
  assert.match(dock, /<div className="oc-field">/);
  assert.match(dock, /<div className="oc-pan-h">/);
  assert.doesNotMatch(dock, /oc-pan-b/);
  assert.match(code, /\}, \[openGame\]\);/, 'the scroll-back runs on a game change');
});

test('The Run: the list header lays its facts on one line with dots under arcade', () => {
  const css = read('app/run/run.css');
  assert.match(arcade(css, '.rn-dock .rn-pan-h small br'), /display:\s*none/);
  assert.match(arcade(css, '.rn-dock .rn-pan-h small .rn-ph + br + .rn-ph::before'), /content:\s*'\\00A0\\00B7\\00A0'/);
});

test('THE OFFSET HOOK measures only a STICKY site bar', () => {
  const hook = read('components/games/useStickyOffset.js');
  assert.match(hook, /document\.querySelector\('\.gi-head'\)/);
  assert.match(hook, /getComputedStyle\(bar\)\.position !== 'sticky'/);
  assert.match(hook, /setProperty\(varName, `\$\{Math\.round\(bar\.getBoundingClientRect\(\)\.height\)\}px`\)/);
});
