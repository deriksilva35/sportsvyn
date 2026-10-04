// lib/seo/tokens.test.mjs - the design tokens are reachable from the chrome.
//
// THIS EXISTS BECAUSE THE MOBILE BURGER SHIPPED INVISIBLE. --paper was declared
// only on [data-surface]. The global header and footer render ABOVE every
// page's data-surface element, so inside them var(--paper) resolved to nothing
// and fell back to the property's initial value - transparent, for a
// background. The hamburger was present in the served HTML, correctly sized,
// display:flex at the right breakpoint and fully tappable, with three
// transparent bars. On a phone that is a site with no navigation.
//
// Four other rules died the same silent death: three nav hover colours and the
// drawer's active-item colour, all var(--paper), all no-ops.
//
// The guard is structural rather than about one token: anything [data-surface]
// declares must also exist on :root, because the chrome is outside every
// surface and cannot see a scoped variable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const globals = src('app/globals.css');

// BRACE-COUNTED, not regex-terminated. A lazy /\n\}/ stops at the first line
// that closes ANY nested construct, which silently truncated the :root block
// and reported font tokens as missing when they were forty lines further down.
// EVERY BLOCK WITH THE SELECTOR, not the first. Tokens v2 (rebrand R0) put a
// second :root block - the semantic layer - above the aliases, and reading only
// the first one reported --paper and the whole alias set as missing.
function declaredIn(selector) {
  const out = new Set();
  let from = 0; let found = false;
  for (;;) {
    const start = globals.indexOf(`${selector} {`, from);
    if (start === -1) break;
    found = true;
    let i = globals.indexOf('{', start); let depth = 0; let end = i;
    for (; i < globals.length; i += 1) {
      if (globals[i] === '{') depth += 1;
      else if (globals[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    for (const x of globals.slice(start, end).matchAll(/(--[a-z0-9-]+)\s*:/g)) out.add(x[1]);
    from = end;
  }
  assert.ok(found, `${selector} block not found in globals.css`);
  return out;
}

test('EVERY [data-surface] token is also on :root - the chrome is outside every surface', () => {
  const missing = [...declaredIn('[data-surface]')].filter((t) => !declaredIn(':root').has(t));
  assert.deepEqual(missing.sort(), [],
    `token(s) invisible to the global header/footer: ${missing.join(', ')}`);
});

test('--paper specifically is on :root, because five chrome rules depend on it', () => {
  assert.ok(declaredIn(':root').has('--paper'),
    'the burger bars, three nav hovers and the drawer active state all use var(--paper)');
});

test('every var() the global chrome uses resolves at :root', () => {
  // site-chrome.css styles the header, drawer and footer - none of which sit
  // inside a data-surface element on any route.
  const chrome = src('components/site-chrome.css');
  const used = new Set([...chrome.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const root = declaredIn(':root');
  // Tokens defined by the chrome sheet itself are fine.
  const selfDefined = new Set([...chrome.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  // Tailwind's `@theme inline` compiles to :root - verified in the served
  // bundle, where --font-mono lands inside a :root rule under @layer theme -
  // so those count as global even though the source block is not literally
  // named :root.
  const themed = declaredIn('@theme inline');
  const unresolved = [...used].filter((t) => !root.has(t) && !selfDefined.has(t) && !themed.has(t));
  assert.deepEqual(unresolved.sort(), [],
    `chrome uses token(s) that do not exist at :root: ${unresolved.join(', ')}`);
});

test('THE BURGER CANNOT GO INVISIBLE AGAIN: its bars carry a literal fallback', () => {
  const chrome = src('components/site-chrome.css');
  assert.match(chrome, /\.gh-burger span \{[^}]*background: var\(--paper, #F5F5F2\)/,
    'an invisible hamburger is a site with no navigation; it gets a fallback');
});

test('the burger is shown, parent-scoped, at the mobile breakpoint', () => {
  const chrome = src('components/site-chrome.css');
  const mobile = chrome.slice(chrome.indexOf('@media (max-width: 1140px)') /* the collapse, 900 -> 1140 on sun-14 */);
  assert.match(mobile, /\.gh \.gh-burger \{ display: flex; \}|\.gh \.gh-burger,[\s\S]*?display: flex/,
    'parent-scoped so chunk order cannot decide it');
});
