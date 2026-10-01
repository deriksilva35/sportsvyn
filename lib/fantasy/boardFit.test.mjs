// lib/fantasy/boardFit.test.mjs - a board name never breaks mid-word (thu-31).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitBoardNames, FIT_SMALL } from './boardFit.js';

const el = (scrollWidth, clientWidth, fit) => ({ scrollWidth, clientWidth, dataset: fit ? { fit } : {} });

test('a name wider than its cell takes the one small step; one that fits keeps the base size', () => {
  const fits = el(24, 24); const wide = el(35, 24);
  assert.equal(fitBoardNames([fits, wide]), 1);
  assert.equal(fits.dataset.fit, undefined);
  assert.equal(wide.dataset.fit, FIT_SMALL);
});

test('a stale shrink is cleared when the cell grows (rotation, the desktop board view)', () => {
  const grown = el(35, 60, FIT_SMALL);
  fitBoardNames([grown]);
  assert.equal(grown.dataset.fit, undefined);
});

test('sub-pixel rounding is not overflow', () => {
  const e = el(24.4, 24);
  fitBoardNames([e]);
  assert.equal(e.dataset.fit, undefined);
});

const css = readFileSync(new URL('../../components/sim/sim.css', import.meta.url), 'utf8');
const rule = (sel) => css.match(new RegExp(`\\n${sel.replace(/[.[\]"=]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';

test('THE CSS BREAKS BETWEEN WORDS ONLY - never mid-word, never hyphenated', () => {
  const n = rule('.bg2 .bc .n');
  assert.ok(n, 'the name rule exists');
  assert.doesNotMatch(css, /overflow-wrap:\s*anywhere/, 'anywhere is how "Etie / nne" happened');
  assert.doesNotMatch(n, /word-break:\s*break-all/);
  assert.match(n, /word-break:\s*normal/);
  assert.match(n, /overflow-wrap:\s*normal/);
  assert.match(n, /hyphens:\s*none/);
  assert.match(n, /-webkit-line-clamp:\s*2/, 'still two lines');
  assert.match(n, /text-overflow:\s*ellipsis/, 'a word that still does not fit is ellipsized');
});

test('THE ONE STEP is one size down from the name, and the room applies it after measuring', () => {
  const sm = rule('.bg2 .bc .n[data-fit="sm"]');
  const base = Number(rule('.bg2 .bc .n').match(/font-size:\s*([\d.]+)px/)[1]);
  const small = Number(sm.match(/font-size:\s*([\d.]+)px/)[1]);
  assert.ok(small < base && base - small <= 1, `one step: ${base} -> ${small}`);
  const room = readFileSync(new URL('../../components/sim/DraftRoom.js', import.meta.url), 'utf8');
  assert.match(room, /fitBoardNames\(el\.querySelectorAll\('\.bc \.n'\)\)/);
  assert.match(room, /new ResizeObserver\(fit\)/, 're-measured when the grid resizes');
});
