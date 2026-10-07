// components/time/kickoffTbdSurfaces.test.mjs - the `tbd` prop on the shared time
// components (tue-10, Time TBD everywhere), RENDERED. SSR via renderToStaticMarkup.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { install } from '../../lib/testing/nextResolve.mjs';
install();

let React, renderToStaticMarkup, StandaloneTime, StandaloneDate, LocalTime, LocalDate, PlayWhen, ViewerTzProvider;
before(async () => {
  React = await import('react');
  ({ renderToStaticMarkup } = await import('react-dom/server'));
  StandaloneTime = (await import('../StandaloneTime.js')).default;
  StandaloneDate = (await import('../StandaloneDate.js')).default;
  LocalTime = (await import('../LocalTime.js')).default;
  LocalDate = (await import('../LocalDate.js')).default;
  PlayWhen = (await import('../games/PlayWhen.js')).default;
  ({ ViewerTzProvider } = await import('./ViewerTz.js'));
});
const html = (C, props, tz) => renderToStaticMarkup(tz === undefined
  ? React.createElement(C, props)
  : React.createElement(ViewerTzProvider, { tz }, React.createElement(C, props)));

// A real first pitch relative to now (two days out, 23:08Z), and a fixed
// midnight-ET placeholder: the placeholder is about the FORMATTER, not about
// whether a game is open, so a typed date is safe there.
const day = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
const REAL = `${day}T23:08:00.000Z`;
const PLACEHOLDER = '2026-10-11T04:00:00Z';

test('StandaloneTime: tbd prints Time TBD in the server zone, the viewer zone and with a provider', () => {
  assert.equal(html(StandaloneTime, { iso: PLACEHOLDER, tbd: true }), 'Time TBD');
  assert.equal(html(StandaloneTime, { iso: PLACEHOLDER, tbd: true, serverTz: 'America/Los_Angeles' }), 'Time TBD');
  assert.equal(html(StandaloneTime, { iso: PLACEHOLDER, tbd: true, weekday: true, zone: false }, 'Europe/London'), 'Time TBD');
});

test('StandaloneTime: without tbd nothing moves (default and explicit false)', () => {
  assert.equal(html(StandaloneTime, { iso: PLACEHOLDER }), '12:00 AM ET');
  assert.equal(html(StandaloneTime, { iso: PLACEHOLDER, tbd: false }, 'America/Los_Angeles'), '9:00 PM PDT');
  assert.match(html(StandaloneTime, { iso: REAL }), /^\d{1,2}:08 [AP]M ET$/);
});

test('StandaloneDate: tbd reads "<date> · Time TBD", never a clock time', () => {
  assert.equal(html(StandaloneDate, { iso: PLACEHOLDER, tbd: true }), 'Sun Oct 11 · Time TBD');
  assert.doesNotMatch(html(StandaloneDate, { iso: PLACEHOLDER, tbd: true }), /\d:\d\d|[AP]M/);
  assert.equal(html(StandaloneDate, { iso: PLACEHOLDER }), 'Sun Oct 11 · 12:00 AM ET');
});

test('LocalTime: tbd prints Time TBD from the first render', () => {
  assert.equal(html(LocalTime, { iso: PLACEHOLDER, tbd: true }), 'Time TBD');
  assert.match(html(LocalTime, { iso: REAL }), /\d:\d\d/);
});

test('LocalDate: a tbd game keeps its ET date (not the evening before in a western zone)', () => {
  assert.equal(html(LocalDate, { iso: PLACEHOLDER, tbd: true }), 'Oct 11');
});

test('PlayWhen (the lobby): tbd prints Time TBD; dates are untouched', () => {
  assert.equal(html(PlayWhen, { iso: PLACEHOLDER, tbd: true }), 'Time TBD');
  assert.equal(html(PlayWhen, { iso: PLACEHOLDER, tbd: true, kind: 'time', now: new Date() }), 'Time TBD');
  assert.equal(html(PlayWhen, { iso: PLACEHOLDER, kind: 'day' }), 'Sun 11 Oct');
});
