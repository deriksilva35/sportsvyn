// components/standaloneDate.test.mjs - StandaloneDate and its date-only
// sibling StandaloneDateOnly (relay 2c-fix item 1), RENDERED.
//
// renderToStaticMarkup is the server render: useViewerZone's SERVER snapshot,
// which is the page's sv_tz (serverTz or ViewerTzProvider) when it has one, and
// the labelled ET fallback when it does not (sun-16 item B). Both are pinned:
// the fallback is never unlabelled, and a page that knows the reader's zone
// prints it in the HTML, with nothing to swap after hydration.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { install } from '../lib/testing/nextResolve.mjs';
install();

let React, renderToStaticMarkup, StandaloneDate, StandaloneDateOnly, StandaloneTime, ViewerTzProvider;
before(async () => {
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  StandaloneDate = (await import('./StandaloneDate.js')).default;
  StandaloneDateOnly = (await import('./StandaloneDateOnly.js')).default;
  StandaloneTime = (await import('./StandaloneTime.js')).default;
  ({ ViewerTzProvider } = await import('./time/ViewerTz.js'));
});
const html = (C, props, tz) => renderToStaticMarkup(tz === undefined
  ? React.createElement(C, props)
  : React.createElement(ViewerTzProvider, { tz }, React.createElement(C, props)));

// 2026-09-08T13:00:00Z is 9:00 AM EDT.
const OPENS_AT = '2026-09-08T13:00:00Z';
// 2026-09-10T00:20:00Z is 8:20 PM EDT the PREVIOUS day - the exact instant
// relay 2c's own PROD dry run used to catch a UTC/ET date-pairing mistake.
const LOCKS_AT = '2026-09-10T00:20:00Z';

test('StandaloneDate: SSR/ET fallback carries the full date, time and zone', () => {
  assert.equal(html(StandaloneDate, { iso: LOCKS_AT }), 'Wed Sep 9 · 8:20 PM ET');
});

test('StandaloneDateOnly: SSR/ET fallback is a bare date - no time, no zone label', () => {
  const out = html(StandaloneDateOnly, { iso: OPENS_AT });
  assert.equal(out, 'Tue Sep 8');
  // Never a time, never a trailing zone abbreviation - the whole reason this
  // sibling exists instead of reusing StandaloneDate for the "opens" clause.
  assert.doesNotMatch(out, /:\d\d|AM|PM|ET|PT|CT|MT/);
});

test('A PAGE THAT KNOWS THE ZONE PRINTS IT IN THE HTML (provider or serverTz)', () => {
  assert.equal(html(StandaloneDate, { iso: LOCKS_AT }, 'America/Los_Angeles'), 'Wed Sep 9 · 5:20 PM PDT');
  assert.equal(html(StandaloneDate, { iso: LOCKS_AT }, 'Europe/London'), 'Thu Sep 10 · 1:20 AM BST');
  assert.equal(html(StandaloneDateOnly, { iso: LOCKS_AT }, 'Europe/London'), 'Thu Sep 10');
  assert.equal(html(StandaloneTime, { iso: LOCKS_AT }, 'Europe/London'), '1:20 AM BST');
  assert.equal(html(StandaloneTime, { iso: LOCKS_AT, serverTz: 'America/Chicago' }), '7:20 PM CDT');
  // An explicit serverTz wins over the provider.
  assert.equal(html(StandaloneTime, { iso: LOCKS_AT, serverTz: 'America/Chicago' }, 'Europe/London'), '7:20 PM CDT');
  // A provider with no cookie (null) is the labelled fallback, as before.
  assert.equal(html(StandaloneTime, { iso: LOCKS_AT }, null), '8:20 PM ET');
});
