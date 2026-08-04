// components/sim/shellRestore.test.mjs — the native-shell WebView restore net.
//
// Two behaviours are pinned here, and both are the kind that fail SILENTLY in
// the wrong direction:
//
//   1. THE RELOAD MUST BE NARROW. It fires on pageshow{persisted:true} and
//      nothing else. Bound to appStateChange / visibilitychange instead, it
//      would reload every time the app is foregrounded - throwing away a live
//      room, a typed search, an in-flight pick - to fix nothing. Backgrounding
//      for five seconds and returning to a WebView that was never evicted must
//      stay seamless.
//   2. IT MUST BE OFF THE WEB. Desktop Safari and Firefox fire
//      pageshow{persisted:true} on ordinary back/forward navigation. Ungated,
//      this would turn every working BFCache restore into a round trip.
//
// React cannot be rendered under node --test here (the @/ alias is a Next build
// concern), so the wiring is read as source - the same approach as
// shellIapUx.test.mjs and shellPurchase.test.mjs.
//
// COMMENTS ARE STRIPPED BEFORE EVERY ASSERTION. This file's own subject matter
// is heavily commented, and an assertion satisfied by prose rather than code is
// worse than no assertion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const SHELL_PERSIST = 'components/sim/ShellPersist.js';

test('the restore reload listens for pageshow and NOTHING else', () => {
  const code = stripComments(src(SHELL_PERSIST));
  assert.match(code, /addEventListener\(\s*'pageshow'/, 'must listen for pageshow');
  // The events that would make this fire on every foreground.
  for (const evt of ['appStateChange', 'visibilitychange', 'focus', 'resume', 'pagehide']) {
    assert.ok(!code.includes(evt),
      `must NOT react to ${evt}: a foreground that did not evict the WebView must not reload`);
  }
});

test('the reload is refused unless the document came out of the BFCache', () => {
  const code = stripComments(src(SHELL_PERSIST));
  // The guard must come BEFORE the reload, and must be an early return on the
  // negative - not a truthiness check that a missing property would pass.
  const guard = code.indexOf('persisted');
  const reload = code.indexOf('location.reload');
  assert.ok(guard > -1, 'must read event.persisted');
  assert.ok(reload > -1, 'must reload');
  assert.ok(guard < reload, 'the persisted check must gate the reload, not follow it');
  assert.match(code, /if\s*\(\s*!\s*\w+\.persisted\s*\)\s*return/,
    'must early-return when persisted is falsy');
});

test('the reload never runs outside the native container', () => {
  const code = stripComments(src(SHELL_PERSIST));
  assert.match(code, /window\.Capacitor|webkit\.messageHandlers/,
    'must feature-detect the native container');
  const gate = code.indexOf('inNativeContainer()');
  const listen = code.indexOf("addEventListener('pageshow'");
  assert.ok(gate > -1 && gate < listen,
    'the container gate must run before the listener is even attached');
  assert.match(code, /if\s*\(\s*!inNativeContainer\(\)\s*\)\s*return/,
    'must bail out of the effect entirely on the web');
});

test('the listener is removed on unmount', () => {
  const code = stripComments(src(SHELL_PERSIST));
  assert.match(code, /removeEventListener\(\s*'pageshow'/,
    'a leaked listener would survive client navigations and stack up');
});

test('the reload lives where the draft room actually mounts it', () => {
  // This is the reason it is in ShellPersist and not IapConfigure. If a future
  // change moves it, this test says why it cannot go to IapConfigure.
  const room = stripComments(src('app/sim/draft/[id]/page.js'));
  assert.ok(room.includes('<ShellPersist />'),
    'the draft room must mount the component that carries the restore reload');
  assert.ok(!room.includes('<IapConfigure'),
    'IapConfigure is NOT mounted in the draft room - the restore reload cannot live there');
});

// ---------------------------------------------------------------------------
// The bundled error page (the net for a TERMINATED web content process, where
// pageshow never fires at all).
// ---------------------------------------------------------------------------

test('Capacitor is configured to show our error page instead of WebKit default', () => {
  const cfg = stripComments(src('capacitor.config.ts'));
  assert.match(cfg, /errorPath:\s*'error\.html'/,
    "without errorPath, didFailProvisionalNavigation only logs and the reader sees WebKit's page");
});

test('the error page is self-contained and offers a route back to the entry', () => {
  const html = src('www/error.html');
  const code = stripComments(html);
  // It is shown BECAUSE the network failed, so it must not depend on the network.
  assert.ok(!/<link[^>]+href=/i.test(code), 'no external stylesheets');
  assert.ok(!/<script[^>]+src=/i.test(code), 'no external scripts');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic/.test(code), 'no remote fonts');
  // ...and it must never dead-end: an absolute way back into the app.
  assert.match(code, /https:\/\/sportsvyn\.com\/sim/, 'must offer fallback-to-entry');
  assert.ok(!/history\.back\(\)/.test(code),
    'history.back() can land on another dead document - the entry URL is the reliable escape');
});
