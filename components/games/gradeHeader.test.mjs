// components/games/gradeHeader.test.mjs - the grade header's eyebrow and
// clock never collide (relay 2b-fix item 1).
//
// WHAT jsdom CAN AND CANNOT ANSWER HERE, stated up front because it decides
// the shape of this file:
//
//   CAN: the winning value of a property on the BASE rule, via the real
//   cascade (lib/testing/computedStyle.mjs's whole reason to exist). The
//   three properties that actually prevent the collision - flex-wrap on the
//   row, min-width:0 on both children - all live in the base rule, so they
//   are checked the strong way, against the real stylesheet.
//
//   CANNOT: evaluate @media at all. Confirmed empirically before writing
//   this - jsdom's getComputedStyle returns the base declaration at every
//   window width, so a "at 320px the font-size is 10px" assertion through
//   jsdom would pass whether or not the media block existed, which is worse
//   than no test. The 390px/320px blocks are therefore asserted as SOURCE
//   (they exist, they target the right selectors, they carry the right
//   breakpoints) and hand-checked on the deployed preview at those two
//   widths - the same division of labour lib/testing/renderJsx.mjs already
//   documents for the RSC pipeline it cannot reach.
//
// WHY min-width:0 IS THE LOAD-BEARING ONE: a flex item defaults to
// min-width:auto, which refuses to shrink below its content width. Without
// it, flex-wrap never gets a chance to fire and the two children overlap
// instead of wrapping - which is exactly the reported bug.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSkeleton } from '../../lib/testing/computedStyle.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS = path.join(__dirname, 'grade.css');

const SKELETON = (target) => `
  <header class="gg-hdr">
    <span class="gg-ed"${target === 'ed' ? ' id="target"' : ''}>The Draft &middot; Week 100 &middot; seat 7</span>
    <span class="gg-clock"${target === 'clock' ? ' id="target"' : ''}>settled Sun, Sep 6, 2:09 AM ET</span>
  </header>`;

function winning(target, prop) {
  const html = target === 'hdr'
    ? `<header class="gg-hdr" id="target"><span class="gg-ed">a</span><span class="gg-clock">b</span></header>`
    : SKELETON(target);
  const { window, target: el } = loadSkeleton(CSS, html);
  return window.getComputedStyle(el)[prop];
}

test('the header row WRAPS rather than overlapping', () => {
  assert.equal(winning('hdr', 'flexWrap'), 'wrap');
});

test('both children may shrink - min-width:0, or wrapping never fires', () => {
  assert.equal(winning('ed', 'minWidth'), '0px');
  assert.equal(winning('clock', 'minWidth'), '0px');
});

test('the eyebrow grows and the clock does not, so the clock is what wraps', () => {
  // flex:1 1 auto vs flex:0 0 auto - the long, variable side is the one that
  // takes the space, and the fixed-width clock is what gets pushed to its
  // own line, not the other way round.
  assert.equal(winning('ed', 'flexGrow'), '1');
  assert.equal(winning('clock', 'flexGrow'), '0');
});

test('the two narrow breakpoints exist and target the header (source, not jsdom)', () => {
  const css = readFileSync(CSS, 'utf8');
  // 390px: the clock drops to its own line and left-aligns under the eyebrow.
  const at390 = css.match(/@media \(max-width: 390px\) \{([\s\S]*?)\n\}/);
  assert.ok(at390, 'a 390px block exists');
  assert.match(at390[1], /\.gg-hdr \.gg-ed \{[^}]*flex-basis: 100%/, 'the eyebrow takes the full row');
  assert.match(at390[1], /\.gg-hdr \.gg-clock \{[^}]*margin-left: 0/, 'the orphan clock left-aligns');

  // 320px: everything still fits one line rather than breaking mid-word.
  const at320 = css.match(/@media \(max-width: 320px\) \{([\s\S]*?)\n\}/);
  assert.ok(at320, 'a 320px block exists');
  assert.match(at320[1], /\.gg-hdr \.gg-ed \{[^}]*letter-spacing/, 'the eyebrow tightens');
  assert.match(at320[1], /\.gg-hdr \.gg-clock \{[^}]*font-size/, 'the clock shrinks');
});
