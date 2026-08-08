// lib/auth/firstSeen.test.mjs — how an account arrived, recorded once.
//
// TWO CREATION SITES, AND THAT IS THE WHOLE HAZARD. This repo creates a user row
// in exactly two places, and only ONE of them goes through the Auth.js adapter:
//
//   · lib/auth/emailOtp.js  - the magic-link path writes the row itself
//   · auth.js events.createUser - the adapter path, which Apple uses
//
// Wiring only the adapter is not hypothetical: it is exactly what shipped on
// 2026-08-07, and the first production magic-link signup got no welcome email
// and left no trace. The tests below assert BOTH sites, because a column that is
// populated for one auth route and silently NULL for the other is worse than no
// column - it looks like data and reads as a lie.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  firstSeenContext, markFirstSeen,
  AUTH_APPLE, AUTH_EMAIL, SURFACE_SHELL, SURFACE_WEB,
} from './firstSeen.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
// The value
// ---------------------------------------------------------------------------

test('the four combinations are the only four values', () => {
  assert.equal(firstSeenContext(AUTH_EMAIL, SURFACE_WEB), 'email:web');
  assert.equal(firstSeenContext(AUTH_EMAIL, SURFACE_SHELL), 'email:shell');
  assert.equal(firstSeenContext(AUTH_APPLE, SURFACE_WEB), 'apple:web');
  assert.equal(firstSeenContext(AUTH_APPLE, SURFACE_SHELL), 'apple:shell');
});

test('unknown inputs fall back inside the vocabulary, never invent a token', () => {
  // A free-text provenance column becomes a landfill nobody can GROUP BY. A
  // wrong-but-countable value is recoverable; a novel one is not.
  for (const bad of ['google', '', null, undefined, 'APPLE', 42, {}]) {
    const v = firstSeenContext(bad, SURFACE_WEB);
    assert.ok(['email:web', 'apple:web'].includes(v), `${JSON.stringify(bad)} produced ${v}`);
  }
  for (const bad of ['ios', '', null, undefined, 'SHELL', 7]) {
    const v = firstSeenContext(AUTH_EMAIL, bad);
    assert.ok(['email:web', 'email:shell'].includes(v), `${JSON.stringify(bad)} produced ${v}`);
  }
  // The safe end of each axis: the path needing no provider handshake, and the
  // larger surface.
  assert.equal(firstSeenContext('nonsense', 'nonsense'), 'email:web');
});

// ---------------------------------------------------------------------------
// Set once
// ---------------------------------------------------------------------------

test('markFirstSeen writes only where the column is NULL', () => {
  // The guard lives in the statement, not in a caller's discipline - both sites
  // route through here and neither can rewrite provenance by accident.
  const code = stripComments(src('lib/auth/firstSeen.js'));
  assert.match(code, /first_seen_context IS NULL/,
    'the set-once rule must be in the WHERE clause');
  assert.ok(!/SET first_seen_context = \$\{context\}\s*WHERE id = \$\{userId\}\s*RETURNING/.test(code),
    'an unguarded update would let a later sign-in rewrite how the account arrived');
});

test('markFirstSeen is inert on bad input and never throws', async () => {
  const never = () => { throw new Error('sql must not be called'); };
  assert.equal(await markFirstSeen(never, null, 'email:web'), false, 'no user id -> no write');
  assert.equal(await markFirstSeen(never, 7, null), false, 'no context -> no write');
  assert.equal(await markFirstSeen(never, 7, ''), false, 'empty context -> no write');
});

test('a failing write is swallowed - provenance never costs a signup', async () => {
  const boom = () => { throw new Error('column "first_seen_context" does not exist'); };
  assert.equal(await markFirstSeen(boom, 7, 'apple:web'), false,
    'a missing column or dead connection must return false, not throw');
});

// ---------------------------------------------------------------------------
// BOTH sites are wired
// ---------------------------------------------------------------------------

test('SITE 1: the magic-link INSERT carries the context atomically', () => {
  const code = stripComments(src('lib/auth/emailOtp.js'));
  assert.match(code, /INSERT INTO users \(email, "emailVerified", first_seen_context\)/,
    'the OTP path must write provenance in the same statement as the row');
  assert.match(code, /firstSeenContext = null/, 'and accept it as a parameter');
  // It must NOT be resolved inside this module - it is unit-tested with no
  // request context, and reading cookies there would make that impossible.
  assert.ok(!/resolveSurface\(/.test(code), 'the OTP module must not read cookies itself');
});

test('SITE 1: its caller resolves the surface where a request exists', () => {
  const code = stripComments(src('app/actions/emailOtp.js'));
  assert.match(code, /firstSeenContext\(AUTH_EMAIL, await resolveSurface\(\)\)/,
    'the server action must resolve and pass the context');
  assert.match(code, /redeemEmailCode\(sql, \{[^}]*firstSeenContext/,
    'and hand it to the creation call');
});

test('SITE 2: the adapter path stamps after creation', () => {
  const code = stripComments(src('auth.js'));
  assert.match(code, /async createUser\(\{ user \}\)/, 'the event must be async to await the stamp');
  assert.match(code, /markFirstSeen\(sql, user\?\.id, ctx\)/, 'and must stamp the new row');
  assert.match(code, /firstSeenContext\(AUTH_APPLE, await resolveSurface\(\)\)/,
    'the adapter path is the Apple route');
  // Wrapped: an unlabelled account is a gap in analytics, a failed one is a lost
  // user. The same doctrine the welcome email follows.
  assert.match(code, /try \{[\s\S]{0,260}markFirstSeen[\s\S]{0,120}catch/,
    'the stamp must never be able to fail account creation');
});

test('neither site can be removed without this failing', () => {
  // The guard against the 2026-08-07 mistake: wiring one path and assuming the
  // other. If either stamp disappears, this test names which one.
  assert.match(stripComments(src('lib/auth/emailOtp.js')), /first_seen_context/,
    'magic-link site lost its stamp');
  assert.match(stripComments(src('auth.js')), /markFirstSeen/,
    'adapter site lost its stamp');
});
