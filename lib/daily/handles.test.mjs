// lib/daily/handles.test.mjs - handles. PURE.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  validateHandle, canonical, anonName, displayName, isClaimed,
  canRename, renameAvailableAt, HANDLE_MIN, HANDLE_MAX, RESERVED, DENYLIST,
} = await import('./handles.js');

test('a good handle passes and keeps the case it was typed in', () => {
  const r = validateHandle('RedZone_Ray');
  assert.equal(r.ok, true);
  assert.equal(r.handle, 'RedZone_Ray', 'display keeps the intent');
  assert.equal(r.canonical, 'redzone_ray', 'uniqueness ignores it');
});

test('LENGTH: 3 to 15, and the bounds are the bounds', () => {
  assert.equal(validateHandle('ab').ok, false);
  assert.equal(validateHandle('abc').ok, true, `${HANDLE_MIN} is allowed`);
  assert.equal(validateHandle('a'.repeat(HANDLE_MAX)).ok, true);
  assert.equal(validateHandle('a'.repeat(HANDLE_MAX + 1)).ok, false);
});

test('CHARSET: no unicode, because a denylist cannot stop homoglyphs', () => {
  // Сlutch with a Cyrillic С renders identically to Clutch. No wordlist
  // catches that; refusing the alphabet does.
  assert.equal(validateHandle('Сlutch').ok, false);
  assert.equal(validateHandle('red zone').ok, false);
  assert.equal(validateHandle('ray!').ok, false);
  assert.equal(validateHandle('ray-ray').ok, false);
  assert.equal(validateHandle('ray_ray').ok, true);
});

test('no leading, trailing or doubled underscore', () => {
  assert.equal(validateHandle('_ray').ok, false);
  assert.equal(validateHandle('ray_').ok, false);
  assert.equal(validateHandle('ray__ray').ok, false);
});

test('RESERVED names are refused - impersonating the house is the one real attack', () => {
  for (const w of ['admin', 'sportsvyn', 'official', 'support', 'daily']) {
    assert.equal(validateHandle(w).ok, false, w);
    assert.equal(validateHandle(w.toUpperCase()).ok, false, `${w} uppercased`);
  }
  assert.ok(RESERVED.has('draftvyn'));
});

test('the anonymous namespace is reserved, or an unclaimed account is impersonable', () => {
  assert.equal(validateHandle('player7f3a').ok, false);
  assert.equal(validateHandle('Player7F3A').ok, false);
  assert.equal(validateHandle('player').ok, false);
  assert.equal(validateHandle('playmaker').ok, true, 'but a real word starting with play is fine');
});

test('the denylist catches the lazy cases and says so without repeating them', () => {
  assert.equal(validateHandle(`x${DENYLIST[0]}x`).ok, false);
  assert.equal(validateHandle(`x${DENYLIST[0]}x`).message, 'Pick another one.');
});

test('every rejection names a machine-readable reason and a human message', () => {
  for (const bad of ['', 'ab', 'a'.repeat(99), 'ray!', '_ray', 'ray__ray', 'admin']) {
    const r = validateHandle(bad);
    assert.equal(r.ok, false, bad);
    assert.ok(r.reason && r.message, `${bad} needs both`);
  }
});

test('canonical trims and lowercases, so uniqueness cannot be dodged with whitespace', () => {
  assert.equal(canonical('  RedZone_Ray '), 'redzone_ray');
  assert.equal(canonical(null), '');
});

// ---------------------------------------------------------------------------
// THE ANONYMOUS NAME
// ---------------------------------------------------------------------------

test('ANON IS NOT THE USER ID: no count, no signup order, not enumerable', () => {
  const n = anonName(37, 'secret');
  assert.match(n, /^Player [0-9a-f]{4}$/);
  assert.equal(/37/.test(n), false, 'the id must not survive into the label');
});

test('anon names are STABLE, so a rival is recognisable week to week', () => {
  assert.equal(anonName(37, 'k'), anonName(37, 'k'));
  assert.notEqual(anonName(37, 'k'), anonName(38, 'k'));
});

test('anon names are KEYED - an unkeyed hash of a small integer is reversible', () => {
  assert.notEqual(anonName(37, 'keyA'), anonName(37, 'keyB'));
});

test('displayName prefers the handle and falls back cleanly', () => {
  assert.equal(displayName({ id: 9, handle: 'pylon' }), '@pylon');
  assert.match(displayName({ id: 9, handle: null }), /^Player [0-9a-f]{4}$/);
  assert.equal(isClaimed({ handle: 'pylon' }), true);
  assert.equal(isClaimed({ handle: null }), false);
});

// ---------------------------------------------------------------------------
// RENAME COOLDOWN
// ---------------------------------------------------------------------------

test('a never-renamed account can rename immediately', () => {
  assert.equal(canRename(null), true);
  assert.equal(renameAvailableAt(null), null);
});

test('RENAME IS ONCE PER 30 DAYS - a leaderboard is a record of who did what', () => {
  const changed = '2026-08-01T00:00:00Z';
  assert.equal(canRename(changed, new Date('2026-08-15T00:00:00Z')), false);
  assert.equal(canRename(changed, new Date('2026-08-30T23:59:00Z')), false);
  assert.equal(canRename(changed, new Date('2026-08-31T00:00:00Z')), true);
});

test('an unparseable changed_at does not lock someone out forever', () => {
  assert.equal(canRename('nonsense'), true);
});
