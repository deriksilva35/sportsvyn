// lib/my/reorder.test.mjs - arrows and drag must be indistinguishable at save.
//
// The ruling is that a drag produces the same persisted layout a matching arrow
// sequence produces. That is only assertable because both paths call the pure
// functions here rather than each mutating state their own way - which is the
// reason this module exists at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { visibleOf, swapAdjacent, moveToIndex } from './reorder.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

const L = (...ids) => ids.map((id) => ({ id }));
const allVisible = () => true;

test('DRAG EQUALS ARROWS - the two paths must save the same layout', () => {
  const start = L('contests', 'pickem', 'fantasy', 'today', 'live');

  // Drag 'contests' down to visible index 2...
  const dragged = moveToIndex(start, 'contests', 2, allVisible);
  // ...and press its down-arrow twice.
  let arrowed = swapAdjacent(start, 'contests', 1, allVisible);
  arrowed = swapAdjacent(arrowed, 'contests', 1, allVisible);

  assert.deepEqual(dragged, arrowed);
  assert.deepEqual(dragged.map((p) => p.id), ['pickem', 'fantasy', 'contests', 'today', 'live']);
});

test('drag equals arrows in the other direction too', () => {
  const start = L('a', 'b', 'c', 'd');
  const dragged = moveToIndex(start, 'd', 1, allVisible);
  let arrowed = swapAdjacent(start, 'd', -1, allVisible);
  arrowed = swapAdjacent(arrowed, 'd', -1, allVisible);
  assert.deepEqual(dragged, arrowed);
  assert.deepEqual(dragged.map((p) => p.id), ['a', 'd', 'b', 'c']);
});

test('every single-step drag equals one arrow press, for every position', () => {
  // The equivalence has to hold generally, not just for the case I picked.
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const start = L(...ids);
  for (let i = 0; i < ids.length; i++) {
    for (const dir of [-1, 1]) {
      const t = i + dir;
      if (t < 0 || t >= ids.length) continue;
      assert.deepEqual(
        moveToIndex(start, ids[i], t, allVisible),
        swapAdjacent(start, ids[i], dir, allVisible),
        `${ids[i]} ${dir > 0 ? 'down' : 'up'} from ${i}`,
      );
    }
  }
});

test('A HIDDEN ENTRY KEEPS ITS SLOT when a visible one is dragged', () => {
  // `active` holds conditional panels and ids whose panel is absent this
  // render. Splicing the stored array directly would shuffle those as a side
  // effect of moving something else, and they would come back in a new order
  // the user never chose.
  const stored = L('contests', 'ghost', 'pickem', 'fantasy');
  const isVisible = (id) => id !== 'ghost';
  const out = moveToIndex(stored, 'contests', 2, isVisible);
  assert.equal(out[1].id, 'ghost', 'the hidden entry did not move');
  assert.deepEqual(visibleOf(out, isVisible).map((p) => p.id), ['pickem', 'fantasy', 'contests']);
  assert.equal(out.length, stored.length, 'nothing was dropped');
});

test('reorder refuses to run off either end, and is a no-op on itself', () => {
  const start = L('a', 'b', 'c');
  assert.deepEqual(swapAdjacent(start, 'a', -1, allVisible), start);
  assert.deepEqual(swapAdjacent(start, 'c', 1, allVisible), start);
  assert.deepEqual(moveToIndex(start, 'b', 1, allVisible), start, 'dropping on itself');
  assert.deepEqual(moveToIndex(start, 'a', 99, allVisible).map((p) => p.id), ['b', 'c', 'a'],
    'an out-of-range target clamps rather than throwing');
  assert.deepEqual(moveToIndex(start, 'nope', 0, allVisible), start, 'unknown id');
});

// ------------------------------------------------------------------ wiring

test('ARROWS ARE UNCHANGED - drag supplements, never replaces', () => {
  const c = src('app/my/CustomizeClient.js');
  // Both arrow buttons still call move(), still disable at the ends.
  assert.match(c, /onClick=\{\(\) => move\(p\.id, -1\)\}/);
  assert.match(c, /onClick=\{\(\) => move\(p\.id, 1\)\}/);
  assert.match(c, /disabled=\{i <= 0\}/);
  assert.match(c, /disabled=\{i >= nonCondPresent\.length - 1\}/);
  // And move() is the arrow path, routed through the shared helper.
  assert.match(c, /function move\(id, dir\) \{\s*setActive\(\(prev\) => swapAdjacent\(prev, id, dir, isVisible\)\);/);
});

test('TOUCH DRAG IS DELIBERATELY NOT WIRED', () => {
  // A scrolling page and a drag gesture compete for the same finger. On phone
  // the arrows remain the path.
  const c = src('app/my/CustomizeClient.js');
  assert.match(c, /if \(e\.pointerType === 'touch'/);
  assert.doesNotMatch(c, /onTouchStart|onTouchMove|ontouchstart/);
});

test('the HANDLE is the only grab target', () => {
  // Cards contain links and buttons; a whole-card drag would swallow them.
  const c = src('app/my/CustomizeClient.js');
  const grip = c.slice(c.indexOf('className="grip"'), c.indexOf('</span>', c.indexOf('className="grip"')));
  assert.match(grip, /onPointerDown=\{\(e\) => onHandleDown\(e, p\.id\)\}/);
  // The slot listens for enter/up to find a drop target, but not for down.
  const slot = c.slice(c.indexOf('className={`panel-slot editing'), c.indexOf('<div className="pedit">'));
  assert.doesNotMatch(slot, /onPointerDown/);
});

test('the save path is unchanged - no new action, no new payload shape', () => {
  const c = src('app/my/CustomizeClient.js');
  assert.match(c, /saveUserLayout\(active, 'my'\)/);
  assert.equal((c.match(/saveUserLayout\(/g) ?? []).length, 1, 'exactly one save call');
  // The sanitizer is untouched.
  assert.match(src('app/actions/dashboard.js'), /vocab\.isValidWrite\(id, \{ bindings: PANEL_BINDINGS \}\)/);
});

test('the drag cannot get stuck when released off a card', () => {
  const c = src('app/my/CustomizeClient.js');
  assert.match(c, /onPointerUp=\{onDrop\} onPointerLeave=\{onDrop\}/);
});
