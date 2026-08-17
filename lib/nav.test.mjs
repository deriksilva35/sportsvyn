// lib/nav.test.mjs - the global navigation, as data. PURE.
//
// THIS FILE EXISTS BECAUSE THE DAILY SHIPPED TO PRODUCTION UNREACHABLE. The nav
// list lived inside a 'use client' component, so nothing could assert on it
// without dragging React into a node test, and a whole product went live with
// no entry in the chrome. The list is data now, and these tests are the guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { NAV, ALIAS, resolveActive, accountMenu, signinHrefFor } = await import('./nav.js');

test('every shipped destination is reachable from the global nav', () => {
  const hrefs = NAV.map((n) => n.href);
  for (const href of ['/', '/daily', '/scores', '/nfl', '/cfb']) {
    assert.ok(hrefs.includes(href), `${href} must be in the global nav`);
  }
});

test('THE DAILY is in the nav, and sits second - right after TODAY', () => {
  const daily = NAV.find((n) => n.key === 'daily');
  assert.ok(daily, 'the Daily needs an entry');
  assert.equal(daily.href, '/daily');
  assert.equal(daily.label, 'THE DAILY');
  assert.equal(NAV.indexOf(daily), 1, 'the daily thing belongs beside today, not at the end');
});

test('nav entries are well formed - every one has a key, a label and an href', () => {
  for (const n of NAV) {
    assert.ok(n.key && n.label && n.href, `malformed nav entry: ${JSON.stringify(n)}`);
    assert.equal(n.label, n.label.toUpperCase(), 'nav labels are uppercase');
    assert.ok(n.href.startsWith('/'), 'nav hrefs are internal paths');
  }
  assert.equal(new Set(NAV.map((n) => n.key)).size, NAV.length, 'keys are unique');
});

test('every ALIAS points at a real nav key, so no legacy call site lights nothing', () => {
  const keys = new Set(NAV.map((n) => n.key));
  for (const [from, to] of Object.entries(ALIAS)) {
    assert.ok(keys.has(to), `alias ${from} -> ${to} points at no nav entry`);
  }
});

test('resolveActive maps legacy keys and passes real ones through', () => {
  assert.equal(resolveActive('home'), 'today');
  assert.equal(resolveActive('fantasy'), 'nfl');
  assert.equal(resolveActive('daily'), 'daily');
  assert.equal(resolveActive(null), null);
  assert.equal(resolveActive(undefined), null);
});

// ---------------------------------------------------------------------------
// THE ACCOUNT MENU
// ---------------------------------------------------------------------------

test('the account menu leads with Account and ends with Sign Out', () => {
  const m = accountMenu();
  assert.equal(m[0].href, '/account', 'Account is the item that answers who am I');
  assert.equal(m[m.length - 1].action, 'signout', 'leaving is the last thing offered');
});

test('SIGN OUT IS ALWAYS PRESENT, in both shell and web', () => {
  for (const shell of [true, false]) {
    const m = accountMenu({ shell });
    assert.ok(m.some((i) => i.action === 'signout'), `no way out in shell=${shell}`);
  }
});

test('3.1.1: no pricing entry inside the native container', () => {
  const web = accountMenu({ shell: false }).map((i) => i.href);
  const app = accountMenu({ shell: true }).map((i) => i.href);
  assert.ok(web.includes('/membership'), 'the web offers membership');
  assert.equal(app.includes('/membership'), false, 'the shell must not');
  // and removing it must not remove anything else
  assert.equal(app.length, web.length - 1);
});

test('the account menu has exactly one action item; everything else navigates', () => {
  const m = accountMenu();
  assert.equal(m.filter((i) => i.action).length, 1);
  for (const i of m.filter((x) => !x.action)) assert.ok(i.href?.startsWith('/'));
});

// ---------------------------------------------------------------------------
// SIGN-IN ROUND TRIP
// ---------------------------------------------------------------------------

test('signinHrefFor carries the reader back to where they were', () => {
  assert.equal(signinHrefFor('/daily'), '/signin?callbackUrl=%2Fdaily');
  assert.equal(signinHrefFor('/nfl/game/abc'), '/signin?callbackUrl=%2Fnfl%2Fgame%2Fabc');
});

test('signinHrefFor never points sign-in back at itself', () => {
  // Without the guard, a signed-out visitor who lands on /signin and taps
  // SIGN IN in the drawer gets ?callbackUrl=/signin and loops.
  assert.equal(signinHrefFor('/signin'), '/signin');
  assert.equal(signinHrefFor('/signin?callbackUrl=%2Fdaily'), '/signin');
  assert.equal(signinHrefFor(null), '/signin');
  assert.equal(signinHrefFor(''), '/signin');
});
