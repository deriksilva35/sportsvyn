// lib/footballdb/teamKey.test.mjs — canonicalTeamKey(), the one function
// that decides a footballdb team_key's stored shape.

import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTeamKey } from './teamKey.js';

const resolver = (name) => ({ 'cincinnati bengals': 'CIN', 'green bay packers': 'GB' }[name.toLowerCase()] ?? null);

test('a current-franchise raw name resolves to its abbreviation', () => {
  assert.equal(canonicalTeamKey('Cincinnati Bengals', resolver), 'CIN');
});

test('a historical era name with no current-franchise match stays the raw name unchanged', () => {
  assert.equal(canonicalTeamKey('Houston Oilers', resolver), 'Houston Oilers');
});

test('an already-canonical abbreviation is a no-op - the resolver is never even called', () => {
  let called = false;
  const spyResolver = (name) => { called = true; return resolver(name); };
  assert.equal(canonicalTeamKey('CIN', spyResolver), 'CIN');
  assert.equal(called, false);
});

test('a team in the historical display map still returns the raw name - display and key are different things', () => {
  // historicalTeamDisplay.js maps 'Oakland Raiders' -> 'OAK' for DISPLAY;
  // canonicalTeamKey does not consult that map at all, and this resolver
  // (a stand-in for teams.name) has no current "Oakland Raiders" franchise.
  assert.equal(canonicalTeamKey('Oakland Raiders', resolver), 'Oakland Raiders');
});
