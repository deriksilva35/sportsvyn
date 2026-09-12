// components/handle/handleGate.test.mjs - the three behaviours of the
// first-entry gate (relay item 5):
//
//   first entry with NO handle  -> blocks, claims, THEN writes
//   first entry WITH a handle   -> passes straight through, no modal
//   cancel                      -> no write at all, nothing saved
//
// TESTED THROUGH A REAL RECONCILER (jsdom + react-dom/client + act), not
// renderToStaticMarkup. The server renderer has no update cycle: setOpen()
// after a render does nothing, and each renderToStaticMarkup call restarts
// hook state from scratch - so it cannot express "guard, then claim, then
// watch the write resume", which is the whole behaviour under test. Tried
// that first and it could not see the modal open at all. act() flushes the
// transitions the way a browser would.
//
// WHY NOT lib/testing/renderJsx.mjs: that helper deliberately refuses a file
// importing anything but react, and HandleGate.js imports HandleClaim and a
// stylesheet through Next-only '@/' aliases. Both are stubbed below, so the
// hook under test is the real one and only its two foreign edges are faked.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'HandleGate.js');

// react-dom/client needs a DOM at import time, so the globals go up first.
const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// defineProperty, not assignment: node 22 exposes globalThis.navigator as a
// getter-only accessor, so `globalThis.navigator = ...` throws outright.
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator, configurable: true, writable: true,
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Compile HandleGate.js with its two Next-only imports stubbed. HandleClaim
 * becomes a marker that exposes its onDone - which is exactly what a
 * successful claim calls - and the stylesheet import is dropped.
 */
async function loadGate() {
  let src = readFileSync(SRC, 'utf8');
  src = src.replace("import HandleClaim from '@/components/daily/HandleClaim';",
    'const HandleClaim = ({ onDone }) => { globalThis.__claim = onDone; return null; };');
  src = src.replace("import '@/components/onboarding/onboarding.css';", '');
  const { code } = transformSync(src, {
    filename: SRC,
    presets: [['@babel/preset-react', { runtime: 'automatic' }]],
  });
  const tmp = path.join(__dirname, `.tmp-gate-${process.pid}.mjs`);
  writeFileSync(tmp, code);
  try { return await import(`${path.resolve(tmp)}?t=${Date.now()}`); }
  finally { unlinkSync(tmp); }
}

const { useHandleGate, HELD } = await loadGate();
const { createElement: h } = await import('react');
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');

/** Mount a host that exposes the live gate, and return the control surface. */
async function mount(hasHandle) {
  const ref = {};
  function Host() {
    const gate = useHandleGate(hasHandle);
    ref.gate = gate;
    return gate.modal ?? null;
  }
  const el = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => { root.render(h(Host)); });

  ref.modalOpen = () => el.querySelector('.onb-scrim') != null;
  ref.guard = async (fn) => { await act(async () => { ref.gate.guard(fn); }); };
  ref.claim = async (v) => { await act(async () => { globalThis.__claim?.(v); }); };
  ref.cancel = async () => {
    // The "Not now" button and the scrim click call the same handler.
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Not now');
    assert.ok(btn, 'the modal offers a way out');
    await act(async () => {
      btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
  };
  return ref;
}

test('WITH a handle: the write goes straight through, no modal', async () => {
  const g = await mount(true);
  let writes = 0;
  await g.guard(() => { writes += 1; });
  assert.equal(writes, 1, 'the write ran on the tap itself');
  assert.equal(g.modalOpen(), false, 'nothing was put in front of it');
});

test('NO handle: the write is BLOCKED, then runs on a successful claim', async () => {
  globalThis.__claim = null;
  const g = await mount(false);
  let writes = 0;
  await g.guard(() => { writes += 1; });
  assert.equal(writes, 0, 'BLOCKED - nothing was written without a handle');
  assert.equal(g.modalOpen(), true, 'the modal is what the reader now sees');
  assert.equal(typeof globalThis.__claim, 'function',
    'the modal wires the real claim component, not a second one');

  await g.claim('newhandle');
  assert.equal(writes, 1, 'the interrupted write PROCEEDED after the claim');
  assert.equal(g.modalOpen(), false, 'and the modal closed behind it');

  // A SECOND write now passes straight through - the gate remembers.
  await g.guard(() => { writes += 1; });
  assert.equal(writes, 2);
  assert.equal(g.modalOpen(), false, 'never asked twice');
});

test('CANCEL: no write now, and the stashed thunk is KEPT for the claim (FRESH-USER FIXES, D3)', async () => {
  globalThis.__claim = null;
  const g = await mount(false);
  let writes = 0;
  await g.guard(() => { writes += 1; });
  assert.equal(g.modalOpen(), true);

  await g.cancel();
  assert.equal(writes, 0, 'cancel wrote nothing yet - no entry row is created behind the reader');
  assert.equal(g.modalOpen(), false, 'and the board is back, not a wall');

  // AND IT IS NOT DROPPED. It used to be: a reader who tapped Not now lost
  // the pick with no sign anything happened. The declined write waits with
  // the row painted pending, and the claim replays it AND whatever came after.
  await g.guard(() => { writes += 10; });
  await g.claim('later');
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  assert.equal(writes, 11, 'both writes ran on the claim - the held one first');
});

test('every guarded surface renders the modal it creates', () => {
  // A component that calls useHandleGate but never renders `modal` would
  // block the write with no way to unblock it - a dead end, and an easy
  // thing to get wrong when wiring a fifth surface later.
  const REPO = path.resolve(__dirname, '..', '..');
  const surfaces = [
    'components/weekly/WeeklyRoom.js',
    'components/draft/SeatSelect.js',
    'components/pickem/PickemBoard.js',
    'components/daily/DailyRoom.js',
  ];
  for (const rel of surfaces) {
    const s = readFileSync(path.join(REPO, rel), 'utf8');
    assert.match(s, /useHandleGate\(/, `${rel} guards its write`);
    assert.match(s, /\{handleModal\}/, `${rel} renders the modal it creates`);
  }
});

// ---------------------------------------------------------------------------
// FRESH-USER FIXES, D3: Not now keeps the stash; claim replays it in order.
// ---------------------------------------------------------------------------
test('D3: Not now KEEPS the write; the key reads as pending; the next write re-opens; claim replays in order', async () => {
  globalThis.__claim = null;
  const g = await mount(false);
  const order = [];
  let held;
  await act(async () => { held = g.gate.guard(() => { order.push('one'); }, 'row-1'); });
  assert.equal(held, HELD, 'guard() says it held the write');
  assert.equal(g.modalOpen(), true);
  await g.cancel();
  assert.equal(g.modalOpen(), false, 'Not now closes the modal');
  assert.equal(order.length, 0, 'and writes nothing');
  assert.ok(g.gate.pending.has('row-1'), 'the row is pending, not forgotten');
  await g.guard(() => { order.push('two'); });
  assert.equal(g.modalOpen(), true, 'the next write re-opens the modal');
  await g.cancel();
  await act(async () => { g.gate.reopen(); });
  assert.equal(g.modalOpen(), true, 'reopen() re-opens it from a pending row');
  await g.claim('newhandle');
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  assert.deepEqual(order, ['one', 'two'], 'every stashed write ran, in order');
  assert.equal(g.gate.pending.size, 0, 'nothing pending after the claim');
  assert.equal(g.modalOpen(), false);
});
