// lib/time/zoneName.test.mjs - A ZONE IS PRINTED SHORT (mon-16).
//
// The Play page told a UTC reader "Coordinated Universal Time". Every zone the
// runtime knows is formatted here, in winter and in summer, and none may come
// out as a long official name - "... Time", "Coordinated ...", "Greenwich Mean".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneNameOf } from './zoneName.js';
import { zoneLabel } from '../you/reads.js';

const WINTER = new Date('2026-01-15T12:00:00Z');
const SUMMER = new Date('2026-07-15T12:00:00Z');
const LONG = /\bTime\b|Coordinated|Greenwich Mean/;

test('the short names Derik listed', () => {
  assert.equal(zoneNameOf('America/Los_Angeles', SUMMER), 'Pacific');
  assert.equal(zoneNameOf('America/New_York', WINTER), 'Eastern');
  assert.equal(zoneNameOf('America/Chicago', SUMMER), 'Central');
  assert.equal(zoneNameOf('America/Denver', WINTER), 'Mountain');
  assert.equal(zoneNameOf('UTC', WINTER), 'UTC');
  assert.equal(zoneNameOf('Etc/UTC', SUMMER), 'UTC');
  assert.equal(zoneNameOf('Europe/London', WINTER), 'GMT');
});

test('NO LONG OFFICIAL NAME, for any zone the runtime knows, either season', () => {
  const zones = Intl.supportedValuesOf('timeZone').concat(['UTC', 'Etc/UTC', 'Etc/GMT']);
  const bad = [];
  for (const tz of zones) {
    for (const at of [WINTER, SUMMER]) {
      const n = zoneNameOf(tz, at);
      if (!n || LONG.test(n)) bad.push(`${tz} -> ${n}`);
    }
  }
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} long names`);
});

test('/you prints the same short name (it was a copy of the long one)', () => {
  assert.equal(zoneLabel('UTC'), 'UTC');
  assert.doesNotMatch(zoneLabel('America/Phoenix'), LONG);
});
