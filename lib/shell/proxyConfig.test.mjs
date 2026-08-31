// lib/shell/proxyConfig.test.mjs — the proxy that turns the param into the
// cookie, and the invariant that keeps the two phases of the move safe.
// Run: node --test lib/shell/proxyConfig.test.mjs
//
// THE PROXY CANNOT BE IMPORTED HERE. It imports next/server, which resolves
// through Next's bundler and not through node's resolver, so these are source
// assertions. That is a real limit and it shapes what is claimed: the matcher
// SHAPE and the constants are pinned here; that the cookie is actually set is
// pinned on PROD by measuring Set-Cookie, because only the running server can
// answer that.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHELL_PARAM, SHELL_VALUE, SHELL_COOKIE } from './constants.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PROXY = 'proxy.js';

// The shell clause is ONE entry in a matcher that also carries plain string
// routes for admin, the competition redirects and /membership. Pull out just
// the object so these assertions speak about the shell rule and not about
// whatever else the proxy is doing.
const shellClause = (t) => {
  const m = t.match(/\{\s*source:[\s\S]*?\n    \}/);
  assert.ok(m, 'the shell matcher clause is missing');
  return m[0];
};

// ---------------------------------------------------------------------------
// THE FILE, AND ITS NEXT 16 NAME
// ---------------------------------------------------------------------------

test('the proxy lives at the repo root under its Next 16 name', () => {
  // Next 16 renamed Middleware to Proxy. A file called middleware.js here
  // would be silently ignored - no error, no cookie, and shell mode quietly
  // stops working in the container.
  assert.ok(existsSync(path.join(REPO, PROXY)), 'proxy.js must be at the repo root');
  assert.ok(!existsSync(path.join(REPO, 'middleware.js')),
    'middleware.js is the Next 15 name and would not run');
  const t = strip(src(PROXY));
  assert.match(t, /export async function proxy\(/, 'the export must be named proxy');
  // The runtime option THROWS in a proxy file rather than being ignored.
  assert.doesNotMatch(t, /export const runtime/, 'setting runtime in a proxy throws');
});

test('THE SHELL CLAUSE IS A GUEST IN THIS FILE - the other duties are intact', () => {
  // I OVERWROTE THIS FILE. Writing the shell clause I created proxy.js from
  // scratch, having checked for middleware.js - the Next 15 name - and
  // concluded nothing was there. proxy.js already held the admin Basic Auth
  // gate, the competition-namespacing redirects and the 3.1.1 membership
  // block, and all three were gone for one commit. Nothing shipped; the
  // original came back out of git. This test is why it cannot happen quietly
  // again: the shell work does not own this file and must prove the other
  // duties still stand beside it.
  const t = strip(src(PROXY));
  assert.match(t, /process\.env\.ADMIN_USERNAME/, 'the admin auth gate must survive');
  assert.match(t, /process\.env\.ADMIN_SECRET/, 'the admin auth gate must survive');
  assert.match(t, /timingSafeEqual/, 'the constant-time compare must survive');
  assert.match(t, /PERMANENT_REDIRECTS/, 'the 308 competition redirects must survive');
  assert.match(t, /resolveCurrentEditionForFamily/, 'the evergreen alias must survive');
  assert.match(t, /pathname === '\/membership'/, 'the 3.1.1 block must survive');
  const m = strip(src(PROXY)).match(/matcher:\s*\[([\s\S]*?)\n  \],/);
  for (const route of ["'/admin'", "'/api/admin'", "'/bracket'", "'/membership'"]) {
    assert.ok(m[1].includes(route), `the matcher must still catch ${route}`);
  }
});

// ---------------------------------------------------------------------------
// THE MATCHER LITERALS, PINNED TO THEIR OWNER
// ---------------------------------------------------------------------------

test('the matcher literals equal the shell constants', () => {
  // They have to be literals - Next statically analyses the config object at
  // build time, and an interpolated SHELL_PARAM is ignored, leaving a proxy
  // that matches nothing and a cookie that is never set. So the duplication is
  // forced, and this is what stops it drifting. Same fault that put a 404 in
  // the switcher's SOCCER row; same treatment.
  const t = strip(src(PROXY));
  const block = shellClause(t);
  assert.match(block, new RegExp(`key:\\s*'${SHELL_PARAM}'`), 'query key');
  assert.match(block, new RegExp(`key:\\s*'${SHELL_COOKIE}'`), 'cookie key');
  const values = [...block.matchAll(/value:\s*'([^']*)'/g)].map((x) => x[1]);
  assert.deepEqual([...new Set(values)], [SHELL_VALUE],
    `every matcher value must be ${SHELL_VALUE}`);
});

test('NEAR-INERT: the matcher requires the param AND the absence of the cookie', () => {
  // The whole cost argument for putting a Node-runtime proxy in front of an
  // app that never had one. `has` alone would run it on every request of a
  // container session; `missing` alone would run it on every request from
  // every web reader. Both together mean it runs on the FIRST hit and never
  // again. Measured on PROD as well - a claim about a config is not a claim
  // about a server.
  const block = shellClause(strip(src(PROXY)));
  assert.match(block, /has:\s*\[\{\s*type:\s*'query'/, 'has: the param');
  assert.match(block, /missing:\s*\[\{\s*type:\s*'cookie'/, 'missing: the cookie');
});

// ---------------------------------------------------------------------------
// THE COOKIE'S SHAPE
// ---------------------------------------------------------------------------

test('it writes a SESSION cookie - no max-age, no expires', () => {
  // Both client setters chose a session cookie deliberately: a web reader who
  // opens a ?shell=sim-app link must not be stuck chromeless after closing the
  // tab, while the native webview's session is long-lived, which is where we
  // want it to persist. Moving the write into the proxy must not quietly
  // upgrade it to a persistent cookie.
  const t = strip(src(PROXY));
  assert.match(t, /name:\s*SHELL_COOKIE/);
  assert.match(t, /value:\s*SHELL_VALUE/);
  assert.match(t, /path:\s*'\/'/);
  assert.doesNotMatch(t, /maxAge|max-age|expires/i, 'the cookie must stay session-scoped');
});

// ---------------------------------------------------------------------------
// THE PHASE INVARIANT — the one that makes the move safe commit by commit
// ---------------------------------------------------------------------------

test('THE PARAM IS NEVER BOTH UNREAD AND UNSET', () => {
  // THE ORDERING RULE, PINNED ON THE TREE RATHER THAN ON HISTORY. A test
  // cannot see the commit graph, and asserting against `git log` would pass on
  // a clean tree and lie on a rebase. What it CAN do is assert the property
  // that every commit must hold, which is stronger than asserting the order of
  // two commits: at no point may the param stop being read by the pages before
  // something else starts turning it into the cookie.
  //
  // So: if resolveShellMode no longer takes a searchParams argument - the
  // signature the reader sweep produces - then the proxy must exist and must
  // set the cookie. Check out any commit in this relay and this holds. Delete
  // the proxy and the sweep fails immediately.
  const resolver = strip(src('lib/shell/shell.js'));
  const sweptServer = !/export async function resolveShellMode\(\s*searchParams\s*\)/.test(resolver);

  const client = strip(src('lib/shell/appTabs.js'));
  const sweptClient = !/isShellClient\(\{[^}]*\bsearch\b/.test(client);

  if (sweptServer || sweptClient) {
    assert.ok(existsSync(path.join(REPO, PROXY)),
      'a reader was swept with no proxy to set the cookie - shell mode would be dead');
    const t = strip(src(PROXY));
    assert.match(t, /cookies\.set\(/, 'the proxy exists but sets no cookie');
    assert.match(t, new RegExp(`key:\\s*'${SHELL_PARAM}'`),
      'the proxy exists but does not match on the param');
  }
});

// ---------------------------------------------------------------------------
// THE WRITERS SURVIVE
// ---------------------------------------------------------------------------

test('EVERY PARAM WRITER SURVIVES THE SWEEP - it is write-only, not dead', () => {
  // The trap in this whole move. A sweep that greps SHELL_PARAM and deletes
  // what it finds breaks sign-in inside the container: these three carry mode
  // across an auth redirect, where the cookie may not exist yet or may not
  // survive the round trip. Readers go; writers stay.
  assert.match(strip(src('lib/shell/signinHref.js')), /SHELL_PARAM/,
    'the sign-in href must still carry the param');
  assert.match(strip(src('lib/shell/signOutTarget.js')), /SHELL_PARAM/,
    'the sign-out target must still carry the param');
  assert.match(strip(src('lib/auth/firstSeen.js')), /SHELL_PARAM/,
    'firstSeen must still read the param out of a callback url');
});
